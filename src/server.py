from __future__ import annotations
import base64, json
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from .geometry import Dimensions, media_geometry

app = FastAPI(title='Cell 001 - Machine Answer Exchange', version='1.0.0')

PRICE_USD = '0.001'
NETWORK = 'base-sepolia'
PAY_TO = '0x0000000000000000000000000000000000000000'  # replace for real testnet use

class Dim(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)

class GeometryRequest(BaseModel):
    source: Dim
    target: Dim
    mode: str = 'crop'
    anchor: str = 'center'


def make_payment_requirements() -> dict:
    # Protocol-shaped metadata for the x402 v2 challenge. A real deployment should
    # use an official x402 middleware/facilitator rather than this educational stub.
    return {
        'x402Version': 2,
        'scheme': 'exact',
        'network': NETWORK,
        'amount': '1000',
        'asset': 'USDC',
        'payTo': PAY_TO,
        'maxTimeoutSeconds': 300,
        'description': 'Cell 001 media geometry answer',
        'mimeType': 'application/json',
    }


def payment_header(requirements: dict) -> str:
    raw = json.dumps({'accepts': [requirements]}, separators=(',', ':')).encode()
    return base64.b64encode(raw).decode()


@app.get('/health')
def health():
    return {'ok': True, 'cell': '001', 'version': '1.0.0'}


@app.post('/v1/media-geometry')
def media_geometry_endpoint(req: GeometryRequest, x_payment_signature: str | None = None):
    # Local proof-of-concept mode. A real x402 middleware should perform verification/settlement.
    if PAY_TO.startswith('0x0000') and x_payment_signature != 'TEST_PAYMENT_OK':
        requirements = make_payment_requirements()
        return_body = {'error': 'payment_required', 'accepts': [requirements]}
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=402,
            content=return_body,
            headers={'PAYMENT-REQUIRED': payment_header(requirements)},
        )
    try:
        result = media_geometry(
            Dimensions(req.source.width, req.source.height),
            Dimensions(req.target.width, req.target.height),
            mode=req.mode,
            anchor=req.anchor,
        )
        return {'ok': True, 'answer': result}
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
