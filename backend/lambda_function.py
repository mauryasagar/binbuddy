import json
import os
import base64
import math
import time
import urllib.request
import urllib.parse
import urllib.error

AI_PROVIDER = os.environ.get("AI_PROVIDER", "gemini").lower()
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
BEDROCK_MODEL = os.environ.get("BEDROCK_MODEL", "us.amazon.nova-lite-v1:0")

PROMPT = """You are BinBuddy, a waste-sorting assistant for India.
Look at the photo of a household item and reply with ONLY valid JSON, no extra text:
{
  "item": "short name of the item",
  "category": "one of: e-waste, dry recyclable, wet/organic, hazardous, reusable, other",
  "bin": "which bin or where it should go, one short sentence",
  "sell_value_inr": "a NARROW realistic range in rupees (upper value at most 2x the lower, like 40-80) that an Indian kabadiwala or e-waste dealer would pay for this item as old or non-working scrap, or 0 if none",
  "why": "one short sentence on why it must not go in the normal dustbin, or why it is fine",
  "search_term": "one of: scrap, e-waste, recycling",
  "pickup_message_en": "a short friendly message to a local scrap collector offering this item for pickup",
  "pickup_message_hi": "the same message in simple Hindi"
}

Pricing rules (approximate Indian scrap rates, adjust for the item's size and material):
- Plastic bottles about Rs 10-20 per kg, paper and cardboard about Rs 10-15 per kg.
- Iron about Rs 25-35 per kg, aluminium about Rs 100-130 per kg, copper about Rs 500-650 per kg.
- Phone charger or cable: Rs 5-20. Old non-working phone: Rs 100-400. Old non-working laptop: Rs 500-1500.
- Never give a range wider than 2x. Say 0 if it has no resale value.
"""


def parse_json(text):
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start:end + 1])


def ask_gemini(image_b64, fmt):
    if not GEMINI_KEY:
        raise Exception("GEMINI_API_KEY is not set")
    payload = {
        "contents": [{
            "parts": [
                {"text": PROMPT},
                {"inline_data": {"mime_type": f"image/{fmt}", "data": image_b64}},
            ]
        }],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
    }
    models = [GEMINI_MODEL, "gemini-flash-latest", "gemini-flash-lite-latest"]
    last_error = ""
    for model in models:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={GEMINI_KEY}"
        )
        for attempt in range(2):
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    out = json.loads(r.read())
                return parse_json(out["candidates"][0]["content"]["parts"][0]["text"])
            except urllib.error.HTTPError as e:
                last_error = model + " -> " + str(e.code) + ": " + e.read().decode()[:200]
                if e.code in (503, 429):
                    time.sleep(1.5)
                    continue
                break
            except Exception as e:
                last_error = model + " -> " + str(e)
                break
    raise Exception("All Gemini models busy or unavailable. Last: " + last_error)


def ask_bedrock(image_b64, fmt):
    import boto3
    client = boto3.client("bedrock-runtime", region_name="us-east-1")
    resp = client.converse(
        modelId=BEDROCK_MODEL,
        messages=[{
            "role": "user",
            "content": [
                {"image": {"format": fmt, "source": {"bytes": base64.b64decode(image_b64)}}},
                {"text": PROMPT},
            ],
        }],
        inferenceConfig={"maxTokens": 600, "temperature": 0.2},
    )
    return parse_json(resp["output"]["message"]["content"][0]["text"])


def ask_model(image_b64, fmt):
    if AI_PROVIDER == "bedrock":
        return ask_bedrock(image_b64, fmt)
    return ask_gemini(image_b64, fmt)


def km(lat1, lon1, lat2, lon2):
    r = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearby_places(lat, lon):
    radius = 15000
    q = (
        "[out:json][timeout:20];("
        f'nwr["shop"="scrap"](around:{radius},{lat},{lon});'
        f'nwr["industrial"="scrap_yard"](around:{radius},{lat},{lon});'
        f'nwr["amenity"="recycling"](around:{radius},{lat},{lon});'
        f'nwr["amenity"="waste_transfer_station"](around:{radius},{lat},{lon});'
        f'nwr["recycling:electrical_items"="yes"](around:{radius},{lat},{lon});'
        ");out center 30;"
    )
    data = urllib.parse.urlencode({"data": q}).encode()
    endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]
    elements = []
    for url in endpoints:
        try:
            req = urllib.request.Request(url, data=data)
            with urllib.request.urlopen(req, timeout=22) as r:
                elements = json.loads(r.read())["elements"]
            break
        except Exception:
            continue
    places = []
    for e in elements:
        plat = e.get("lat") or (e.get("center") or {}).get("lat")
        plon = e.get("lon") or (e.get("center") or {}).get("lon")
        if plat is None or plon is None:
            continue
        tags = e.get("tags", {})
        places.append({
            "name": tags.get("name") or tags.get("operator") or "Recycling / scrap point",
            "lat": plat,
            "lon": plon,
            "distance_km": round(km(lat, lon, plat, plon), 1),
        })
    places.sort(key=lambda p: p["distance_km"])
    return places[:5]


def respond(code, body):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    try:
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode()
        body = json.loads(raw)

        fmt = body.get("format", "jpeg").lower()
        if fmt == "jpg":
            fmt = "jpeg"

        result = ask_model(body["image"], fmt)

        lat, lon = body.get("lat"), body.get("lon")
        result["places"] = nearby_places(float(lat), float(lon)) if lat and lon else []

        return respond(200, result)
    except Exception as ex:
        return respond(500, {"error": str(ex)})