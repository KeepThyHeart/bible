#!/usr/bin/env python3
"""
scripts/yubikey-sign.py -- sign module catalogs, and vouch for new signing keys,
with an Ed25519 key that lives on a YubiKey.

The desktop app verifies catalogs in `CatalogSignatureVerifier.ts`: Ed25519 over
the SHA-256 digest of the exact catalog bytes, detached into `catalog.json.sig`.
This produces that file without the private key ever leaving the YubiKey's
OpenPGP applet.

## Why Python

Yubico's own library (`yubikit`, shipped with `ykman`) talks to the card over
PC/SC.  Doing the same from Node would need a native PC/SC module; this needs
only `apt install yubikey-manager pcscd` (or `pip install yubikey-manager`).

## Why the digest goes to the card as-is

For EdDSA, the OpenPGP applet signs exactly the bytes it is sent -- yubikit
never hashes an EdDSA message.  Sending the 32-byte SHA-256 digest therefore
yields Ed25519(sk, sha256(catalog)), which is precisely what the verifier
checks with `verify(null, digest, key, sig)`.  Every signature is also verified
locally before anything is written, so a mismatch fails here, not in the app.

## Several signatures on one catalog

Running `sign` again on an unchanged catalog, with a different YubiKey plugged
in, ADDS that key's signature (`signatures` in the `.sig`) instead of replacing
the first.  The first signature stays the primary -- the only one app versions
before multi-signature support read -- so during a rotation, sign with the OLD
key first.  Signing a catalog whose bytes have changed starts over.

## Publish date

When `sign` starts over (no still-valid `.sig` beside the catalog), it sets
`repository.published` to the current UTC time and rewrites `catalog.json` as
2-space-indented JSON before signing, so the signature covers the date.
`--no-stamp` signs the file exactly as it is.

## Catalog index

`sign` also signs the official catalog index (`index.json`, see
`CatalogIndex.ts`), which lists the separate catalogs published under the
official domain.  Only the index's top-level `published` is stamped.  Re-sign
it when a catalog is added or removed; adding a module to one catalog needs
only that catalog re-signed.

## Vouching for a new key

`vouch` signs a statement that a NEW key may sign the official catalog, and
adds it to a `.vouches` file to upload beside the catalog.  Installs that trust
this YubiKey's key but not the new one will ask their user whether to trust
it.  The statement is signed over a different message from any catalog
signature (see `CatalogKeyVouches.ts`), so a catalog signature can never serve
as a vouch; `sign` also refuses anything that is not a catalog.  `vouch` shows
the new key and makes you type its last 8 characters before it signs.

## Usage

    # One-time: wipe the OpenPGP applet and generate a fresh signing key on it.
    # Other YubiKey functions (FIDO/U2F, OTP, PIV, OATH) are not touched.
    python3 scripts/yubikey-sign.py setup --reset-openpgp

    # Print the hex public key (the value that goes into OFFICIAL_PUBLIC_KEYS).
    python3 scripts/yubikey-sign.py pubkey

    # Sign a catalog (or the index); writes catalog.json.sig beside it.
    python3 scripts/yubikey-sign.py sign path/to/catalog.json
    python3 scripts/yubikey-sign.py sign path/to/index.json

    # Vouch for the key on a new YubiKey (run with the OLD YubiKey plugged in).
    python3 scripts/yubikey-sign.py vouch path/to/catalog.json.vouches --new-key <hex>

If the card cannot be opened, GnuPG's scdaemon is probably holding it:
`gpgconf --kill scdaemon` releases it.
"""

import argparse
import getpass
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    from ykman.device import list_all_devices
    from yubikit.core.smartcard import SmartCardConnection
    from yubikit.openpgp import KEY_REF, OID, UIF, OpenPgpSession
except ImportError as err:
    sys.exit(f"Missing dependency ({err.name}). Install yubikey-manager: "
             "`sudo apt install yubikey-manager pcscd` or `pip install yubikey-manager`.")

ALGORITHM = 'ed25519-sha256'
EDDSA_ALGORITHM_ID = 0x16
# Mirrors MAX_CATALOG_SIGNATURES in CatalogSignatureVerifier.ts.
MAX_SIGNATURES = 8

# Mirrors CATALOG_INDEX_FORMAT in CatalogIndex.ts.
INDEX_FORMAT = 'kth-bible-catalog-index'

# Mirror CatalogKeyVouches.ts.
VOUCH_FORMAT = 'kth-bible-key-vouches'
VOUCH_VERSION = 1
VOUCH_MAGIC = 'KTH-BIBLE-KEY-VOUCH-V1'
MAX_VOUCHES = 32

# Factory defaults after an OpenPGP reset.  `setup` uses them only for the
# minutes between reset and the user changing them.
DEFAULT_PIN = '123456'
DEFAULT_ADMIN_PIN = '12345678'

TRUSTED_KEYS_FILE = (Path(__file__).resolve().parent.parent
                     / 'apps/desktop/electron/services/trustedCatalogKeys.ts')


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def open_session():
    """Open the OpenPGP applet on the single connected YubiKey."""
    devices = [(dev, info) for dev, info in list_all_devices()
               if dev.supports_connection(SmartCardConnection)]
    if not devices:
        sys.exit('No YubiKey found. Is it plugged in and is pcscd running? '
                 'If GnuPG was used recently, run `gpgconf --kill scdaemon` and retry.')
    if len(devices) > 1:
        sys.exit('More than one YubiKey is connected; unplug all but the signing key.')

    dev, info = devices[0]
    try:
        conn = dev.open_connection(SmartCardConnection)
    except Exception as err:  # pcsc raises a variety of types here
        sys.exit(f'Could not open the YubiKey ({err}). '
                 'If GnuPG is holding it, run `gpgconf --kill scdaemon` and retry.')
    return conn, OpenPgpSession(conn), info


def raw_public_key(public_key) -> str:
    if not isinstance(public_key, Ed25519PublicKey):
        sys.exit('The signature slot does not hold an Ed25519 key. Run `setup` first.')
    return public_key.public_bytes(Encoding.Raw, PublicFormat.Raw).hex()


def card_public_key(session):
    if session.get_algorithm_attributes(KEY_REF.SIG).algorithm_id != EDDSA_ALGORITHM_ID:
        sys.exit('The signature slot does not hold an Ed25519 key. Run `setup` first.')
    return session.get_public_key(KEY_REF.SIG)


def card_sign(session, data: bytes, pin: str) -> bytes:
    """Sign `data` as-is (EdDSA never pre-hashes), prompting for a touch if required."""
    session.verify_pin(pin)
    if session.get_uif(KEY_REF.SIG) != UIF.OFF:
        print('Touch the YubiKey to sign...', file=sys.stderr)
    return session.sign(data, hashes.SHA256())


def read_pin(args) -> str:
    if args.pin_stdin:
        return sys.stdin.readline().rstrip('\r\n')
    return getpass.getpass('YubiKey user PIN: ')


def ts_array(name: str) -> str:
    """The text between the brackets of `NAME ... = [ ... ]` in trustedCatalogKeys.ts."""
    try:
        source = TRUSTED_KEYS_FILE.read_text(encoding='utf-8')
    except OSError:
        return ''
    match = re.search(rf'{name}[^=]*=\s*\[(.*?)\]', source, re.DOTALL)
    return match.group(1) if match else ''


def pinned_keys() -> list:
    """The hex keys in OFFICIAL_PUBLIC_KEYS, lowercased; [] if the file can't be read."""
    return [key.lower() for key in re.findall(r'[0-9a-fA-F]{64}', ts_array('OFFICIAL_PUBLIC_KEYS'))]


def official_scope() -> str:
    prefixes = re.findall(r"'(https://[^']+)'", ts_array('OFFICIAL_CATALOG_URL_PREFIXES'))
    if not prefixes:
        sys.exit(f'Could not read OFFICIAL_CATALOG_URL_PREFIXES from {TRUSTED_KEYS_FILE}.')
    return prefixes[0]


def vouch_message(scope: str, vouching_key: str, new_key: str, issued: str) -> bytes:
    """The exact bytes a vouch signature covers -- must match vouchMessage() in CatalogKeyVouches.ts."""
    return (f'{VOUCH_MAGIC}\n'
            f'scope: {scope}\n'
            f'vouching-key: {vouching_key.lower()}\n'
            f'new-key: {new_key.lower()}\n'
            f'issued: {issued}\n').encode('utf-8')


def load_signable(path: Path) -> dict:
    """Parse the file and insist it is a catalog or a catalog index, so `sign` can never be
    pointed at anything else."""
    try:
        doc = json.loads(path.read_bytes())
    except (OSError, ValueError) as err:
        sys.exit(f'{path} is not readable JSON ({err}).')
    if isinstance(doc, dict) and doc.get('format') == INDEX_FORMAT:
        if not isinstance(doc.get('catalogs'), list):
            sys.exit(f'{path} is a catalog index with no "catalogs" list; refusing to sign it.')
        return doc
    if (not isinstance(doc, dict) or doc.get('format') == VOUCH_FORMAT
            or not isinstance(doc.get('repository'), dict)
            or not isinstance(doc.get('modules'), list)):
        sys.exit(f'{path} is neither a module catalog (with "repository" and "modules") nor a '
                 'catalog index; refusing to sign it.')
    return doc


def still_valid_signatures(sig_path: Path, digest: bytes) -> list:
    """Signatures in an existing `.sig` that verify over these exact catalog bytes, in order."""
    if not sig_path.exists():
        return []
    try:
        doc = json.loads(sig_path.read_text(encoding='utf-8'))
        entries = [doc] + list(doc.get('signatures') or [])
    except (OSError, ValueError, AttributeError, TypeError):
        print(f'Ignoring unreadable {sig_path}.', file=sys.stderr)
        return []

    valid, stale = [], 0
    for entry in entries:
        try:
            key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(entry['publicKey']))
            key.verify(bytes.fromhex(entry['signature']), digest)
        except (InvalidSignature, KeyError, TypeError, ValueError):
            stale += 1
            continue
        valid.append({'publicKey': entry['publicKey'].lower(),
                      'signature': entry['signature'].lower(),
                      'algorithm': ALGORITHM})
    if stale:
        print(f'Dropping {stale} signature(s) in {sig_path} that do not match the catalog as it is now.',
              file=sys.stderr)
    return valid


def load_vouches(path: Path) -> dict:
    if not path.exists():
        return {'format': VOUCH_FORMAT, 'version': VOUCH_VERSION, 'vouches': []}
    try:
        doc = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as err:
        sys.exit(f'{path} is not readable JSON ({err}).')
    if (not isinstance(doc, dict) or doc.get('format') != VOUCH_FORMAT
            or doc.get('version') != VOUCH_VERSION or not isinstance(doc.get('vouches'), list)):
        sys.exit(f'{path} is not a key-vouch document; refusing to add to it.')
    if len(doc['vouches']) >= MAX_VOUCHES:
        sys.exit(f'{path} already holds {MAX_VOUCHES} vouches, the most the app reads.')
    return doc


def cmd_setup(args):
    if not args.reset_openpgp:
        sys.exit('`setup` wipes every key in the YubiKey OpenPGP applet and resets its PINs.\n'
                 'Re-run with --reset-openpgp to confirm.')

    conn, session, info = open_session()
    with conn:
        if session.version < (5, 2, 3):
            sys.exit(f'OpenPGP applet {session.version} cannot generate Ed25519 keys '
                     '(needs YubiKey firmware 5.2.3 or later).')

        print(f'Resetting OpenPGP applet on YubiKey {info.serial}...', file=sys.stderr)
        session.reset()
        session.verify_admin(DEFAULT_ADMIN_PIN)

        print('Generating Ed25519 signing key on the YubiKey...', file=sys.stderr)
        public_key = raw_public_key(session.generate_ec_key(KEY_REF.SIG, OID.Ed25519))

        if not args.no_touch:
            session.set_uif(KEY_REF.SIG, UIF.ON)

    print(public_key)
    print(f'\nPublic key (add to OFFICIAL_PUBLIC_KEYS): {public_key}\n'
          f'Touch required to sign: {"no" if args.no_touch else "yes"}\n\n'
          f'The PINs are now the factory defaults ({DEFAULT_PIN} / {DEFAULT_ADMIN_PIN}). '
          'Change them now:\n'
          '    ykman openpgp access change-pin\n'
          '    ykman openpgp access change-admin-pin', file=sys.stderr)


def cmd_pubkey(_args):
    conn, session, _info = open_session()
    with conn:
        print(raw_public_key(card_public_key(session)))


def cmd_sign(args):
    target = Path(args.file)
    out = Path(args.out) if args.out else target.with_name(target.name + '.sig')
    doc = load_signable(target)
    original_bytes = target.read_bytes()
    catalog_bytes = original_bytes
    kept = still_valid_signatures(out, hashlib.sha256(catalog_bytes).digest())

    if kept:
        print(f'{out} already holds {len(kept)} valid signature(s); adding this key\'s. '
              'The file is not modified.', file=sys.stderr)
    elif not args.no_stamp:
        is_index = doc.get('format') == INDEX_FORMAT
        published = utc_now()
        (doc if is_index else doc['repository'])['published'] = published
        catalog_bytes = (json.dumps(doc, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
        print(f'Stamping {"published" if is_index else "repository.published"} = {published}',
              file=sys.stderr)

    digest = hashlib.sha256(catalog_bytes).digest()
    pin = read_pin(args)

    conn, session, _info = open_session()
    with conn:
        public_key = card_public_key(session)
        public_hex = raw_public_key(public_key)
        pinned = pinned_keys()
        if pinned and public_hex not in pinned:
            print(f'WARNING: this key ({public_hex[:8]}...) is not in OFFICIAL_PUBLIC_KEYS. Installs '
                  'accept it for the official catalog only if another signature on the catalog is '
                  'by a pinned key, or through a vouch their user approves.', file=sys.stderr)
        signature = card_sign(session, digest, pin)

    try:
        public_key.verify(signature, digest)
    except InvalidSignature:
        sys.exit('The YubiKey returned a signature that does not verify. Nothing was written.')

    entry = {'publicKey': public_hex, 'signature': signature.hex(), 'algorithm': ALGORITHM}
    entries = [entry if existing['publicKey'] == public_hex else existing for existing in kept]
    if entry not in entries:
        entries.append(entry)
    if len(entries) > MAX_SIGNATURES:
        sys.exit(f'A catalog may carry at most {MAX_SIGNATURES} signatures. Nothing was written.')

    sig_doc = dict(entries[0])
    if len(entries) > 1:
        sig_doc['signatures'] = entries[1:]

    if catalog_bytes != original_bytes:
        target.write_bytes(catalog_bytes)
        print(f'Rewrote {target}', file=sys.stderr)
    out.write_text(json.dumps(sig_doc, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {out} ({len(entries)} signature(s))', file=sys.stderr)


def cmd_vouch(args):
    new_key = args.new_key.strip().lower()
    if not re.fullmatch(r'[0-9a-f]{64}', new_key):
        sys.exit('--new-key must be 64 hex characters (a raw Ed25519 public key, as `pubkey` prints).')
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(new_key))
    except ValueError:
        sys.exit('--new-key is not a valid Ed25519 public key.')

    scope = official_scope()
    out = Path(args.vouches_file)
    doc = load_vouches(out)

    conn, session, _info = open_session()
    with conn:
        public_key = card_public_key(session)
        vouching_key = raw_public_key(public_key)
        if new_key == vouching_key:
            sys.exit('A key cannot vouch for itself.')

        print('You are about to vouch, with the key on this YubiKey, that a NEW key may sign\n'
              'the official catalog. Every install that trusts this YubiKey\'s key will ask its\n'
              'user whether to trust the new key too.\n\n'
              f'  scope:         {scope}\n'
              f'  this YubiKey:  {vouching_key}\n'
              f'  NEW key:       {new_key}\n', file=sys.stderr)
        print('Type the last 8 characters of the NEW key to confirm: ', end='', file=sys.stderr, flush=True)
        if sys.stdin.readline().strip().lower() != new_key[-8:]:
            sys.exit('Confirmation did not match; nothing was signed.')

        issued = utc_now()
        message = vouch_message(scope, vouching_key, new_key, issued)
        signature = card_sign(session, message, read_pin(args))

    try:
        public_key.verify(signature, message)
    except InvalidSignature:
        sys.exit('The YubiKey returned a signature that does not verify. Nothing was written.')

    doc['vouches'].append({'vouchingKey': vouching_key, 'newKey': new_key, 'scope': scope,
                           'issued': issued, 'signature': signature.hex()})
    out.write_text(json.dumps(doc, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {out} ({len(doc["vouches"])} vouch(es)). Upload it beside catalog.json.',
          file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description='Sign module catalogs with a YubiKey-held Ed25519 key.')
    sub = parser.add_subparsers(dest='command', required=True)

    setup = sub.add_parser('setup', help='reset the OpenPGP applet and generate a new Ed25519 signing key')
    setup.add_argument('--reset-openpgp', action='store_true',
                       help='confirm wiping all existing OpenPGP keys on the YubiKey')
    setup.add_argument('--no-touch', action='store_true',
                       help='do not require a physical touch for each signature')
    setup.set_defaults(func=cmd_setup)

    pubkey = sub.add_parser('pubkey', help='print the hex public key of the signing slot')
    pubkey.set_defaults(func=cmd_pubkey)

    sign = sub.add_parser('sign', help='write (or add to) a detached <file>.sig for a catalog or index')
    sign.add_argument('file', help='the catalog or index.json to sign (its exact bytes are signed)')
    sign.add_argument('--out', help='signature path (default: <file>.sig)')
    sign.add_argument('--no-stamp', action='store_true',
                      help='do not set the published date; sign the file exactly as it is')
    sign.add_argument('--pin-stdin', action='store_true', help='read the user PIN from stdin')
    sign.set_defaults(func=cmd_sign)

    vouch = sub.add_parser('vouch', help='vouch that a NEW key may sign the official catalog')
    vouch.add_argument('vouches_file',
                       help='the .vouches document to add to (created if missing), e.g. catalog.json.vouches')
    vouch.add_argument('--new-key', required=True, help='hex public key being vouched for')
    vouch.add_argument('--pin-stdin', action='store_true',
                       help='read the user PIN from stdin, on the line after the confirmation')
    vouch.set_defaults(func=cmd_vouch)

    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
