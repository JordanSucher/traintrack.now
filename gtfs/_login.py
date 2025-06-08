# ruff: noqa: ASYNC230

import json
from pathlib import Path
import os
import re
import time
import datetime as dt
import email.utils
import requests
from requests.auth import HTTPBasicAuth

CODE_RE = re.compile(r"\b(\d{6})\b")

from findmy.reports import (
    AppleAccount,
    AsyncAppleAccount,
    BaseAnisetteProvider,
    LoginState,
    SmsSecondFactorMethod,
    TrustedDeviceSecondFactorMethod,
)

ACCOUNT_STORE = "account.json"

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


def get_account_sync(anisette: BaseAnisetteProvider) -> AppleAccount:
    """Tries to restore a saved Apple account, or prompts the user for login otherwise. (sync)"""
    acc = AppleAccount(anisette)

    # Save / restore account logic
    acc_store = Path("account.json")
    try:
        with acc_store.open() as f:
            acc.restore(json.load(f))
    except FileNotFoundError:
        _login_sync(acc)
        # with acc_store.open("w+") as f:
        #     json.dump(acc.export(), f)

    return acc


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
        # with acc_store.open("w+") as f:
        #     json.dump(acc.export(), f)

    return acc
