"""Find the TypeSafe API key without ever hard-coding it.

Lookup order:
1. The TYPESAFE_API_KEY environment variable (a gitignored .env file is loaded into it).
2. The OS keychain, via the `keyring` package (stored with `jev-eval set-key`).
"""

import getpass
import os

import keyring
from dotenv import load_dotenv
from keyring.errors import KeyringError, PasswordDeleteError

ENV_VAR = "TYPESAFE_API_KEY"
KEYRING_SERVICE = "jev-eval"
KEYRING_USERNAME = "typesafe-api-key"


def load_api_key() -> str | None:
    # override=False means a real environment variable wins over the .env file.
    load_dotenv(override=False)
    key = os.environ.get(ENV_VAR, "").strip()
    if key:
        return key
    try:
        return keyring.get_password(KEYRING_SERVICE, KEYRING_USERNAME)
    except KeyringError:
        # No keychain backend (common on headless Linux); the env var is the only source then.
        return None


def prompt_and_store_key() -> None:
    # getpass hides what you type, so the key never shows on screen or in shell history.
    key = getpass.getpass("Paste your TypeSafe API key (input hidden): ").strip()
    if not key:
        raise SystemExit("No key entered; nothing stored.")
    keyring.set_password(KEYRING_SERVICE, KEYRING_USERNAME, key)
    print(f"Stored in the OS keychain ({keyring.get_keyring().name}).")


def delete_stored_key() -> None:
    try:
        keyring.delete_password(KEYRING_SERVICE, KEYRING_USERNAME)
        print("Removed the key from the OS keychain.")
    except PasswordDeleteError:
        print("No key was stored in the OS keychain.")
