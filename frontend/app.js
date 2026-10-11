const API_URL = "https://33g56mswvufasmxekpa7cjrtye0pqcve.lambda-url.us-east-1.on.aws/";

const $ = (id) => document.getElementById(id);
let imageB64 = null;
let data = null;
let lang = "en";

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").className = "status" + (isError ? " error" : "");
}

function resizeToBase64(file, maxSide = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8).split(",")[1]);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { timeout: 8000 }
    );
  });
}

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("Please choose an image file.", true);
    return;
  }
  $("preview").src = URL.createObjectURL(file);
  $("preview").style.display = "block";
  $("dzEmpty").style.display = "none";
  $("result").style.display = "none";
  try {
    imageB64 = await resizeToBase64(file);
    $("go").disabled = false;
    setStatus("");
  } catch (err) {
    setStatus("Could not read that image. Try another one.", true);
  }
}

$("photo").addEventListener("change", (e) => handleFile(e.target.files[0]));

const dz = $("dropzone");
["dragenter", "dragover"].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); })
);
dz.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

$("go").addEventListener("click", async () => {
  if (!imageB64) return;
  const btn = $("go");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Analysing…';
  $("result").style.display = "none";
  setStatus("Looking at your item and finding nearby places…");

  const loc = await getLocation();
  try {
    const body = { image: imageB64, format: "jpeg" };
    if (loc) { body.lat = loc.lat; body.lon = loc.lon; }
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    data = json;
    render(!!loc);
    setStatus("");
  } catch (err) {
    setStatus("Something went wrong: " + err.message, true);
  }
  btn.disabled = false;
  btn.textContent = "Analyse item";
});

function render(hadLocation) {
  $("item").textContent = data.item || "Unknown item";
  const cat = (data.category || "other").toLowerCase();
  $("cat").textContent = cat;
  $("cat").className = "badge " + cat.replace(/[^a-z]+/g, "-");
  $("bin").textContent = data.bin || "";
  $("why").textContent = data.why || "";
  const v = String(data.sell_value_inr || "0");
  $("val").textContent = v === "0" ? "No resale value" : "₹" + v;

  const box = $("places");
  box.innerHTML = "";
  if (!data.places || !data.places.length) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = hadLocation
      ? "No listed points within 7 km. Try searching 'kabadi' or 'e-waste recycler' on Google Maps."
      : "Allow location access to see nearby scrap shops and recyclers.";
    box.appendChild(d);
  } else {
    data.places.forEach((p) => {
      const row = document.createElement("div");
      row.className = "place";
      const left = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = p.name;
      const dist = document.createElement("small");
      dist.textContent = p.distance_km + " km away";
      left.appendChild(name);
      left.appendChild(dist);
      const a = document.createElement("a");
      a.textContent = "Open in Maps";
      a.target = "_blank";
      a.rel = "noopener";
      a.href = "https://www.google.com/maps/search/?api=1&query=" + p.lat + "," + p.lon;
      row.appendChild(left);
      row.appendChild(a);
      box.appendChild(row);
    });
  }

  showMessage();
  $("result").style.display = "block";
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showMessage() {
  const text = lang === "hi" ? data.pickup_message_hi : data.pickup_message_en;
  $("msg").value = text || "";
  $("wa").href = "https://wa.me/?text=" + encodeURIComponent(text || "");
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    lang = tab.dataset.lang;
    if (data) showMessage();
  });
});

$("msg").addEventListener("input", () => {
  $("wa").href = "https://wa.me/?text=" + encodeURIComponent($("msg").value);
});

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("msg").value);
    $("copy").textContent = "Copied ✓";
  } catch (e) {
    $("msg").select();
  }
  setTimeout(() => ($("copy").textContent = "Copy"), 1500);
});

$("again").addEventListener("click", () => {
  imageB64 = null;
  data = null;
  $("photo").value = "";
  $("preview").style.display = "none";
  $("dzEmpty").style.display = "flex";
  $("result").style.display = "none";
  $("go").disabled = true;
  setStatus("");
  document.getElementById("try").scrollIntoView({ behavior: "smooth" });
});