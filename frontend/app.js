const API_URL = "https://33g56mswvufasmxekpa7cjrtye0pqcve.lambda-url.us-east-1.on.aws/";

function animateHeroParticles() {
  const particles = document.querySelectorAll(".particle");
  if (!particles.length) return;

  const paths = [
    [140, -150, 6200, 0.2], [-120, 170, 7600, 1.4], [150, -120, 6800, 2.2],
    [-150, 150, 8200, 0.8], [120, -180, 7000, 2.8], [-160, 130, 7800, 1.8],
    [100, -160, 6400, 3.4], [-130, 170, 8600, 2.5], [-110, -130, 7200, 4],
    [130, 120, 5800, 0.5], [-90, -140, 7400, 1.1], [150, 110, 6900, 2.7],
    [-130, -100, 8100, 3.1], [110, 160, 6300, 0.4], [-80, 120, 7700, 1.9],
    [120, -130, 7200, 3.7], [-150, 90, 8500, 2.1], [100, 140, 6600, 4.4],
    [-100, -150, 7900, 0.9], [140, 100, 6100, 2.5],
  ];
  const scheduleFrame = window.requestAnimationFrame
    ? (callback) => window.requestAnimationFrame(callback)
    : (callback) => window.setTimeout(() => callback(performance.now()), 16);
  const startedAt = performance.now();
  function frame(now) {
    const elapsed = now - startedAt;
    particles.forEach((particle, index) => {
      const [x, y, duration, phase] = paths[index % paths.length];
        const motionDuration = duration * 4;
        const xProgress = Math.sin((elapsed / motionDuration) * Math.PI * 2 + phase);
        const yProgress = Math.cos((elapsed / (motionDuration * 1.27)) * Math.PI * 2 + phase * 1.6);
        const activity = (Math.abs(xProgress) + Math.abs(yProgress)) / 2;
        const opacity = 0.35 + (activity * 0.5);
        const scale = 0.72 + (activity * 0.46);
      particle.style.opacity = opacity.toFixed(2);
        particle.style.transform = `translate3d(${(x * xProgress).toFixed(1)}px, ${(y * yProgress).toFixed(1)}px, 0) scale(${scale.toFixed(2)})`;
    });
    scheduleFrame(frame);
  }
  scheduleFrame(frame);
}

animateHeroParticles();

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

let chosenLoc = null;

document.querySelectorAll(".loc-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".loc-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    $("locNote").textContent = "";
    $("locInput").value = "";
    if (chip.dataset.loc === "me") {
      chosenLoc = null;
    } else {
      const [lat, lon] = chip.dataset.loc.split(",").map(Number);
      chosenLoc = { lat, lon };
    }
  });
});

$("locForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("locInput").value.trim();
  if (!q) return;
  $("locNote").textContent = "Searching…";
  try {
    const res = await fetch(
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=" + encodeURIComponent(q)
    );
    const found = await res.json();
    if (!found.length) {
      $("locNote").textContent = "Place not found. Try another name.";
      return;
    }
    chosenLoc = { lat: parseFloat(found[0].lat), lon: parseFloat(found[0].lon) };
    document.querySelectorAll(".loc-chip").forEach((c) => c.classList.remove("active"));
    $("locNote").textContent = "Searching near: " + found[0].display_name.split(",").slice(0, 2).join(",");
  } catch (err) {
    $("locNote").textContent = "Could not look up that place.";
  }
});

function getLocation() {
  if (chosenLoc) return Promise.resolve(chosenLoc);
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
  $("whyResult").textContent = data.why || "";
  const v = String(data.sell_value_inr || "0");
  $("val").textContent = v === "0" ? "No resale value" : "₹" + v;

  const box = $("places");
  box.innerHTML = "";
  if (!data.places || !data.places.length) {
    const d = document.createElement("div");
    d.className = "empty";
    if (hadLocation) {
      d.innerHTML = 'No listed points found nearby. <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/kabadi+e-waste+recycler+near+me">Search kabadi / e-waste recycler on Google Maps</a>';
    } else {
      d.textContent = "Allow location access to see nearby scrap shops and recyclers.";
    }
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