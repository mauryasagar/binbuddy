import json
import base64
import math
import urllib.request
import urllib.parse
import boto3

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
MODEL_ID = "amazon.nova-lite-v1:0"

PROMPT = """You are BinBuddy, a waste-sorting assistant for India.
Look at the photo of a household item and reply with ONLY valid JSON, no extra text:
{
  "item": "short name of the item",
  "category": "one of: e-waste, dry recyclable, wet/organic, hazardous, reusable, other",
  "bin": "which bin or where it should go, one short sentence",
  "sell_value_inr": "rough scrap value in rupees like 10-30, or 0 if none",
  "why": "one short sentence on why it must not go in the normal dustbin, or why it is fine",
  "search_term": "one of: scrap, e-waste, recycling",
  "pickup_message_en": "a short friendly message to a local scrap collector offering this item for pickup",
  "pickup_message_hi": "the same message in simple Hindi"
}"""


def ask_model(image_bytes, fmt):
    resp = bedrock.converse(
        modelId=MODEL_ID,
        messages=[{
            "role": "user",
            "content": [
                {"image": {"format": fmt, "source": {"bytes": image_bytes}}},
                {"text": PROMPT},
            ],
        }],
        inferenceConfig={"maxTokens": 600, "temperature": 0.2},
    )
    text = resp["output"]["message"]["content"][0]["text"]
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start:end + 1])


def km(lat1, lon1, lat2, lon2):
    r = 6371
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearby_places(lat, lon):
    q = (
        "[out:json][timeout:15];("
        f'nwr["shop"="scrap"](around:7000,{lat},{lon});'
        f'nwr["amenity"="recycling"](around:7000,{lat},{lon});'
        f'nwr["recycling:electrical_items"="yes"](around:7000,{lat},{lon});'
        ");out center 20;"
    )
    data = urllib.parse.urlencode({"data": q}).encode()
    req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=data)
    try:
        with urllib.request.urlopen(req, timeout=18) as r:
            elements = json.loads(r.read())["elements"]
    except Exception:
        return []
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
        image_bytes = base64.b64decode(body["image"])

        result = ask_model(image_bytes, fmt)

        lat, lon = body.get("lat"), body.get("lon")
        result["places"] = nearby_places(float(lat), float(lon)) if lat and lon else []

        return respond(200, result)
    except Exception as ex:
        return respond(500, {"error": str(ex)})