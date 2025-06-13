import logging
import sys
import os
from findmy import KeyPair
from findmy.reports import RemoteAnisetteProvider
from collections.abc import MutableSequence
import re
import time
import datetime as dt
import email.utils
import requests
import typing
from requests.auth import HTTPBasicAuth
import vercel_blob
from cryptography.fernet import Fernet, InvalidToken

# URL to (public or local) anisette server
ANISETTE_SERVER = os.environ.get("ANISETTE_SERVER")
# ANISETTE_SERVER = "https://ani.sidestore.io/"

logging.basicConfig(level=logging.INFO)

# ruff: noqa: ASYNC230

import json
from pathlib import Path
import os

from findmy.reports import (
    AppleAccount,
    AsyncAppleAccount,
    BaseAnisetteProvider,
    LoginState,
    SmsSecondFactorMethod,
    TrustedDeviceSecondFactorMethod,
)

BLOB_PATH   = "account.json"
BLOB_BASE_URL   = os.getenv("VERCEL_BLOB_STORE_URL")
BLOB_URL    = f"{BLOB_BASE_URL}/{BLOB_PATH}"

FERNET_KEY  = os.environ["BLOB_KEY"].encode()
cipher      = Fernet(FERNET_KEY)

CODE_RE = re.compile(r"\b(\d{6})\b")

def _encrypt_json(obj: dict) -> bytes:
    return cipher.encrypt(json.dumps(obj, separators=(",", ":")).encode())

def _decrypt_json(blob: bytes) -> dict:
    try:
        return json.loads(cipher.decrypt(blob))
    except InvalidToken:
        raise ValueError("The blob could not be decrypted (wrong key or tampered data).")

def _download_json(url: str) -> dict:
    meta = vercel_blob.head(url)                          # cheap HEAD call
    blob = requests.get(meta["downloadUrl"], timeout=10).content
    return _decrypt_json(blob)

def _upload_json(path: str, data: dict) -> None:
    vercel_blob.put(
        path,
        _encrypt_json(data),
        {
            "contentType": "application/octet-stream",
            "allowOverwrite": "true"
        }
    )

def _fetch_code_from_twilio(max_wait: int = 30, poll_every: int = 5, freshness_secs: int = 60) -> str:
    sid   = os.environ["TWILIO_SID"]
    token = os.environ["TWILIO_SECRET"]
    my_to = os.environ["TWILIO_NUMBER"]

    url    = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    auth   = HTTPBasicAuth(sid, token)
    params = {             
        "To"      : my_to,  
        "PageSize": 20,     
    }

    deadline = time.time() + max_wait
    freshness_delta = dt.timedelta(seconds=freshness_secs)

    while time.time() < deadline:
        r = requests.get(url, params=params, auth=auth, timeout=10)
        r.raise_for_status()
        messages = r.json().get("messages", [])

        # --- sort newest>oldest by DateSent just in case -------------------
        messages.sort(
            key=lambda m: email.utils.parsedate_to_datetime(m["date_sent"]),
            reverse=True,
        )

        now = dt.datetime.now(dt.timezone.utc)

        for msg in messages:
            if msg["direction"] != "inbound":
                continue

            sent_at = email.utils.parsedate_to_datetime(msg["date_sent"])
            if (now - sent_at) > freshness_delta:
                # too old, ignore; keep looping so we can wait for a fresh one
                continue

            body = msg["body"]
            m    = CODE_RE.search(body)
            if m and "Apple" in body:
                return m.group(1)

        time.sleep(poll_every)

    raise TimeoutError("Timed out waiting for Apple 2FA SMS via Twilio.")

def get_account_sync(anisette: BaseAnisetteProvider) -> AppleAccount:
    acc = AppleAccount(anisette)

    try:
        # ---------- RESTORE ----------
        saved_state = _download_json(BLOB_URL)
        acc.restore(saved_state)
    except:
        _login_sync(acc)
        # ---------- SAVE --------------
        _upload_json(BLOB_PATH, acc.export())

    return acc


def _login_sync(account: AppleAccount) -> None:
    email = os.environ.get("BEACON_EMAIL")
    password = os.environ.get("BEACON_PASSWORD")

    state = account.login(email, password)

    if state == LoginState.REQUIRE_2FA:  # Account requires 2FA
        # This only supports SMS methods for now
        
        twilio_digits = re.sub(r"\D", "", os.environ["TWILIO_NUMBER"])[-4:]

        sms_methods = [
            m for m in account.get_2fa_methods() if isinstance(m, SmsSecondFactorMethod)
        ]
        if not sms_methods:
            raise RuntimeError("No SMS 2FA methods found on this Apple ID.")

        def last4(masked: str) -> str:
            return re.sub(r"\D", "", masked)[-4:]
        
        method = next(
            (m for m in sms_methods if last4(m.phone_number) == twilio_digits),
            sms_methods[0]    # fallback to first SMS method
        )

        method.request()
        #code = input("Code? > ")
        code = _fetch_code_from_twilio()

        # This automatically finishes the post-2FA login flow
        method.submit(code)

def fetch_reports(priv_keys: MutableSequence[str]) -> int:

    acc = get_account_sync(
        RemoteAnisetteProvider(ANISETTE_SERVER),
    )

    print(f"Logged in as: {acc.account_name} ({acc.first_name} {acc.last_name})")
    
    reports = {}

    for priv_key in priv_keys:
        key = KeyPair.from_b64(priv_key)
        temp_reports = acc.fetch_last_reports(key)
        temp_reports = sorted(temp_reports)
        temp_reports = temp_reports[-200:] if len(temp_reports) > 200 else temp_reports
        reports[key] = temp_reports

    return reports


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <private key>", file=sys.stderr)
        print(file=sys.stderr)
        print("The private key should be base64-encoded.", file=sys.stderr)
        sys.exit(1)

    sys.exit(fetch_reports(sys.argv[1]))

async def _login_async(account: AsyncAppleAccount) -> None:
    email = input("email?  > ")
    password = input("passwd? > ")

    state = await account.login(email, password)

    if state == LoginState.REQUIRE_2FA:  # Account requires 2FA
        # This only supports SMS methods for now
        methods = await account.get_2fa_methods()

        # Print the (masked) phone numbers
        for i, method in enumerate(methods):
            if isinstance(method, TrustedDeviceSecondFactorMethod):
                print(f"{i} - Trusted Device")
            elif isinstance(method, SmsSecondFactorMethod):
                print(f"{i} - SMS ({method.phone_number})")

        ind = int(input("Method? > "))

        method = methods[ind]
        await method.request()
        code = input("Code? > ")

        # This automatically finishes the post-2FA login flow
        await method.submit(code)


async def get_account_async(anisette: BaseAnisetteProvider) -> AsyncAppleAccount:
    """Tries to restore a saved Apple account, or prompts the user for login otherwise. (async)"""
    acc = AsyncAppleAccount(anisette)

    # Save / restore account logic
    acc_store = Path("account.json")
    try:
        with acc_store.open() as f:
            acc.restore(json.load(f))
    except FileNotFoundError:
        await _login_async(acc)
        with acc_store.open("w+") as f:
            json.dump(acc.export(), f)

    return acc
