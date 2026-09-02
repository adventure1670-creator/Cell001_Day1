"""Fail-closed atomic network configuration validator tests."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVAL_SCRIPT = ROOT / "tests" / "eval_resolve_network_config.ts"

MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
MAINNET_PAY_TO = "0xd38fe438F96C9E21AcdA8d3E9ecE8C4156157dc0"
SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
# Environment-configured Sepolia payee from wrangler.jsonc env.testnet; not hardcoded in the validator.
SEPOLIA_PAY_TO = "0xf6D6D35764138b0179Fd6838fa43b02ae12E46Dc"


def call_resolve(env: dict) -> dict:
    result = subprocess.run(
        ["node", "--experimental-strip-types", str(EVAL_SCRIPT)],
        input=json.dumps(env),
        capture_output=True,
        text=True,
        cwd=str(ROOT),
        timeout=30,
        check=False,
    )
    if not result.stdout.strip():
        raise AssertionError(f"validator runner produced no stdout: {result.stderr}")
    return json.loads(result.stdout)


def expect_error(env: dict) -> str:
    payload = call_resolve(env)
    assert payload["ok"] is False, payload
    assert payload["error"].startswith("CONFIG_INTEGRITY_ERROR")
    return payload["error"]


def expect_ok(env: dict) -> dict:
    payload = call_resolve(env)
    assert payload["ok"] is True, payload
    return payload["result"]


def valid_mainnet(**overrides):
    env = {
        "NETWORK": "base",
        "CHAIN_ID": "8453",
        "USDC": MAINNET_USDC,
        "PAY_TO": MAINNET_PAY_TO,
    }
    env.update(overrides)
    return env


def valid_sepolia(**overrides):
    env = {
        "NETWORK": "base-sepolia",
        "CHAIN_ID": "84532",
        "USDC": SEPOLIA_USDC,
        "PAY_TO": SEPOLIA_PAY_TO,
    }
    env.update(overrides)
    return env


def test_missing_network():
    expect_error({"CHAIN_ID": "8453", "USDC": MAINNET_USDC, "PAY_TO": MAINNET_PAY_TO})


def test_unsupported_network():
    expect_error(valid_mainnet(NETWORK="ethereum"))


def test_missing_mainnet_chain_id():
    env = valid_mainnet()
    del env["CHAIN_ID"]
    expect_error(env)


def test_missing_mainnet_usdc_binding():
    env = valid_mainnet()
    del env["USDC"]
    env["USDC_ADDRESS"] = MAINNET_USDC
    expect_error(env)


def test_missing_mainnet_pay_to():
    env = valid_mainnet()
    del env["PAY_TO"]
    expect_error(env)


def test_incorrect_mainnet_chain_id():
    expect_error(valid_mainnet(CHAIN_ID="84532"))


def test_incorrect_mainnet_usdc():
    expect_error(valid_mainnet(USDC=SEPOLIA_USDC))


def test_incorrect_mainnet_pay_to():
    expect_error(valid_mainnet(PAY_TO=SEPOLIA_PAY_TO))


def test_valid_mainnet_tuple():
    result = expect_ok(valid_mainnet())
    assert result["network"] == "base"
    assert result["chainId"] == "8453"
    assert result["usdc"] == MAINNET_USDC
    assert result["payTo"] == MAINNET_PAY_TO


def test_valid_mainnet_tuple_equivalent_address_casing():
    result = expect_ok(
        valid_mainnet(
            USDC=MAINNET_USDC.lower(),
            PAY_TO=MAINNET_PAY_TO.upper(),
        )
    )
    assert result["network"] == "base"
    assert result["usdc"] == MAINNET_USDC.lower()
    assert result["payTo"] == MAINNET_PAY_TO.upper()


def test_missing_sepolia_pay_to():
    env = valid_sepolia()
    del env["PAY_TO"]
    expect_error(env)


def test_sepolia_using_mainnet_pay_to():
    expect_error(valid_sepolia(PAY_TO=MAINNET_PAY_TO))


def test_sepolia_using_mainnet_pay_to_different_casing():
    expect_error(valid_sepolia(PAY_TO=MAINNET_PAY_TO.upper()))


def test_incorrect_sepolia_chain_id():
    expect_error(valid_sepolia(CHAIN_ID="8453"))


def test_incorrect_sepolia_usdc():
    expect_error(valid_sepolia(USDC=MAINNET_USDC))


def test_valid_sepolia_tuple():
    result = expect_ok(valid_sepolia())
    assert result["network"] == "base-sepolia"
    assert result["chainId"] == "84532"
    assert result["usdc"] == SEPOLIA_USDC
    assert result["payTo"] == SEPOLIA_PAY_TO
