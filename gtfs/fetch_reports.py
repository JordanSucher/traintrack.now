import logging
import sys

from findmy import KeyPair
from findmy.reports import RemoteAnisetteProvider

# URL to (public or local) anisette server
# ANISETTE_SERVER = "https://ani.sidestore.io"
ANISETTE_SERVER = "https://ani.npeg.us/"

logging.basicConfig(level=logging.INFO)


def fetch_reports(priv_key: str) -> int:
    key = KeyPair.from_b64(priv_key)
    acc = get_account_sync(
        RemoteAnisetteProvider(ANISETTE_SERVER),
    )

    print(f"Logged in as: {acc.account_name} ({acc.first_name} {acc.last_name})")

    # It's that simple!
    reports = acc.fetch_last_reports(key)
    reports = sorted(reports)
    reports = reports[-200:] if len(reports) > 200 else reports
    for report in reports:
        print(report)

    return reports


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <private key>", file=sys.stderr)
        print(file=sys.stderr)
        print("The private key should be base64-encoded.", file=sys.stderr)
        sys.exit(1)

    sys.exit(fetch_reports(sys.argv[1]))


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

ACCOUNT_STORE = "account.json"


def _login_sync(account: AppleAccount) -> None:
    email = os.environ.get("BEACON_EMAIL")
    password = os.environ.get("BEACON_PASSWORD")

    state = account.login(email, password)

    if state == LoginState.REQUIRE_2FA:  # Account requires 2FA
        # This only supports SMS methods for now
        methods = account.get_2fa_methods()

        # Print the (masked) phone numbers
        for i, method in enumerate(methods):
            if isinstance(method, TrustedDeviceSecondFactorMethod):
                print(f"{i} - Trusted Device")
            elif isinstance(method, SmsSecondFactorMethod):
                print(f"{i} - SMS ({method.phone_number})")

        ind = int(input("Method? > "))

        method = methods[ind]
        method.request()
        code = input("Code? > ")

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
        with acc_store.open("w+") as f:
            json.dump(acc.export(), f)

    return acc
