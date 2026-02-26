/* SnapReady — Frontend Logic */

// Change this to your Render URL later!
const API_BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:8000'
  : 'https://snap-ready.onrender.com';

document.addEventListener("DOMContentLoaded", () => {
  // === Upload Page ===
  const uploadForm = document.getElementById("upload-form");
  if (uploadForm) {
    initUploadPage();
  }

  // === Result Page (comparison slider) ===
  const comparison = document.getElementById("comparison");
  if (comparison) {
    initResultPage();
    initComparisonSlider();
    initIntensityReprocess();
  }
});

/* ---- Upload Page ---- */
function initUploadPage() {
  const form = document.getElementById("upload-form");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const previewArea = document.getElementById("preview-area");
  const previewImg = document.getElementById("preview-img");
  const clearBtn = document.getElementById("clear-btn");
  const submitBtn = document.getElementById("submit-btn");
  const errorBanner = document.getElementById("error-banner");
  const spinner = document.getElementById("spinner-overlay");

  // Click to browse
  dropzone.addEventListener("click", () => fileInput.click());

  // Drag and drop
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      showPreview(e.dataTransfer.files[0]);
    }
  });

  // File selected
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) {
      showPreview(fileInput.files[0]);
    }
  });

  function showPreview(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      previewArea.hidden = false;
      dropzone.hidden = true;
      submitBtn.disabled = false;
      errorBanner.hidden = true;
    };
    reader.readAsDataURL(file);
  }

  // Clear
  clearBtn.addEventListener("click", () => {
    fileInput.value = "";
    previewArea.hidden = true;
    dropzone.hidden = false;
    submitBtn.disabled = true;
  });

  // Submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBanner.hidden = true;
    spinner.classList.add("active");

    const formData = new FormData(form);

    try {
      const resp = await fetch(`${API_BASE_URL}/process`, { method: "POST", body: formData });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.detail || "Processing failed");
      }
      const data = await resp.json();
      window.location.href = `/result.html?job_id=${data.job_id}`;
    } catch (err) {
      spinner.classList.remove("active");
      errorBanner.textContent = err.message;
      errorBanner.hidden = false;
    }
  });
}

/* ---- Result Page Init ---- */
function initResultPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('job_id');
  const intensity = urlParams.get('intensity') || 'medium';

  if (!jobId) {
    window.location.href = '/';
    return;
  }

  // Set initial images
  document.getElementById('before-img').src = `${API_BASE_URL}/uploads/${jobId}/cropped_square.jpg`;
  document.getElementById('after-img').src = `${API_BASE_URL}/uploads/${jobId}/retouched.jpg`;
  document.getElementById('download-btn').href = `${API_BASE_URL}/download/${jobId}`;

  // Set initial radio
  const radio = document.querySelector(`input[name="intensity"][value="${intensity}"]`);
  if (radio) radio.checked = true;
}

/* ---- Comparison Slider ---- */
function initComparisonSlider() {
  const container = document.getElementById("comparison");
  const overlay = document.getElementById("overlay");
  const handle = document.getElementById("handle");
  let isDragging = false;

  function updatePosition(clientX) {
    const rect = container.getBoundingClientRect();
    let x = (clientX - rect.left) / rect.width;
    x = Math.max(0, Math.min(1, x));
    const pct = x * 100;
    overlay.style.clipPath = `inset(0 0 0 ${pct}%)`;
    handle.style.left = `${pct}%`;
  }

  container.addEventListener("mousedown", (e) => {
    isDragging = true;
    updatePosition(e.clientX);
  });
  document.addEventListener("mousemove", (e) => {
    if (isDragging) updatePosition(e.clientX);
  });
  document.addEventListener("mouseup", () => { isDragging = false; });

  // Touch support
  container.addEventListener("touchstart", (e) => {
    isDragging = true;
    updatePosition(e.touches[0].clientX);
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (isDragging) updatePosition(e.touches[0].clientX);
  }, { passive: true });
  document.addEventListener("touchend", () => { isDragging = false; });
}

/* ---- Intensity Reprocess ---- */
function initIntensityReprocess() {
  const radios = document.querySelectorAll('input[name="intensity"]');
  const spinner = document.getElementById("spinner-overlay");
  const afterImg = document.getElementById("after-img");

  radios.forEach((radio) => {
    radio.addEventListener("change", async () => {
      spinner.classList.add("active");

      const formData = new FormData();
      formData.append("intensity", radio.value);

      const urlParams = new URLSearchParams(window.location.search);
      const jobId = urlParams.get('job_id');

      try {
        const resp = await fetch(`${API_BASE_URL}/reprocess/${jobId}`, {
          method: "POST",
          body: formData,
        });
        if (!resp.ok) {
          const data = await resp.json();
          throw new Error(data.detail || "Reprocessing failed");
        }
        // Cache-bust reload of retouched image
        afterImg.src = `${API_BASE_URL}/uploads/${jobId}/retouched.jpg?t=${Date.now()}`;

        // Update URL so a refresh keeps the same intensity
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('intensity', radio.value);
        window.history.replaceState({}, '', newUrl);
      } catch (err) {
        alert(err.message);
      } finally {
        spinner.classList.remove("active");
      }
    });
  });
}
