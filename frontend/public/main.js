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
    initGallery();
  }

  // === Result Page (comparison slider) ===
  const comparison = document.getElementById("comparison");
  if (comparison) {
    initResultPage();
    initComparisonSlider();
    initIntensityReprocess();
    initFeedback();
  }
});

// History Manager
const JobHistory = {
  get: () => JSON.parse(localStorage.getItem('snapready_jobs') || '[]'),
  add: (jobId) => {
    const jobs = JobHistory.get();
    if (!jobs.includes(jobId)) {
      jobs.unshift(jobId);
      localStorage.setItem('snapready_jobs', JSON.stringify(jobs));
    }
  }
};

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
      JobHistory.add(data.job_id);

      // Reset form visually, but don't redirect yet
      spinner.classList.remove("active");
      clearBtn.click();

      // Show in gallery and start polling
      addJobToGallery(data.job_id, true);
      pollJob(data.job_id);

    } catch (err) {
      spinner.classList.remove("active");
      errorBanner.textContent = err.message;
      errorBanner.hidden = false;
    }
  });
}

/* ---- Gallery & Polling ---- */
function initGallery() {
  const jobs = JobHistory.get();
  if (jobs.length > 0) {
    document.getElementById("gallery-section").hidden = false;
    jobs.forEach(jobId => {
      addJobToGallery(jobId, false);
      // Verify status of returning jobs
      pollJob(jobId);
    });
  }
}

function addJobToGallery(jobId, isNew = false) {
  const section = document.getElementById("gallery-section");
  const grid = document.getElementById("gallery-grid");
  section.hidden = false;

  // Don't add duplicate
  if (document.getElementById(`job-${jobId}`)) return;

  const item = document.createElement("div");
  item.className = "gallery-item";
  item.id = `job-${jobId}`;

  // Skeleton loader initially
  item.innerHTML = `
    <div class="gallery-loader" id="loader-${jobId}">
      <div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0"></div>
    </div>
    <img id="img-${jobId}" style="opacity:0">
  `;

  if (isNew) {
    grid.prepend(item);
  } else {
    grid.appendChild(item);
  }

  item.addEventListener("click", () => {
    // Only clickable if finished (loader is hidden)
    if (document.getElementById(`loader-${jobId}`).hidden) {
      window.location.href = `/result.html?job_id=${jobId}`;
    }
  });
}

function updateGalleryItem(jobId, status) {
  const loader = document.getElementById(`loader-${jobId}`);
  const img = document.getElementById(`img-${jobId}`);
  if (!loader || !img) return;

  if (status === "completed") {
    loader.hidden = true;
    img.src = `${API_BASE_URL}/uploads/${jobId}/retouched.jpg?t=${Date.now()}`;
    img.style.opacity = "1";
  } else if (status === "failed") {
    loader.innerHTML = `<span style="color:var(--red)">Failed</span>`;
  }
}

async function pollJob(jobId) {
  try {
    const resp = await fetch(`${API_BASE_URL}/status/${jobId}`);

    // If the backend says 404, the job files were deleted (e.g. Render server restarted)
    if (resp.status === 404) {
      updateGalleryItem(jobId, "expired");

      // Remove from history
      const jobs = JobHistory.get().filter(id => id !== jobId);
      localStorage.setItem('snapready_jobs', JSON.stringify(jobs));

      // Remove from UI after a brief delay
      setTimeout(() => {
        const item = document.getElementById(`job-${jobId}`);
        if (item) item.remove();

        // Hide section if empty
        if (JobHistory.get().length === 0) {
          document.getElementById("gallery-section").hidden = true;
        }
      }, 2000);
      return;
    }

    if (!resp.ok) return;
    const data = await resp.json();

    updateGalleryItem(jobId, data.status);

    if (data.status === "processing") {
      setTimeout(() => pollJob(jobId), 2000);
    }
  } catch (e) {
    console.warn("Polling error", e);
  }
}

/* ---- Result Page Init ---- */
function initResultPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('job_id');
  const intensity = urlParams.get('intensity') || 'medium';
  const zoom = urlParams.get('zoom') || '1.0';

  if (!jobId) {
    window.location.href = '/';
    return;
  }

  // Set initial images
  document.getElementById('before-img').src = `${API_BASE_URL}/uploads/${jobId}/cropped_square.jpg`;
  document.getElementById('after-img').src = `${API_BASE_URL}/uploads/${jobId}/retouched.jpg`;
  document.getElementById('download-btn').href = `${API_BASE_URL}/download/${jobId}`;

  // Set initial controls
  const radio = document.querySelector(`input[name="intensity"][value="${intensity}"]`);
  if (radio) radio.checked = true;

  const zoomSlider = document.getElementById("crop-zoom");
  if (zoomSlider) zoomSlider.value = zoom;
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

/* ---- Intensity & Zoom Reprocess ---- */
function initIntensityReprocess() {
  const controls = document.querySelectorAll('input[name="intensity"], input[name="zoom"]');
  const spinner = document.getElementById("spinner-overlay");
  const beforeImg = document.getElementById("before-img");
  const afterImg = document.getElementById("after-img");
  let pollingInterval;

  controls.forEach((control) => {
    control.addEventListener("change", async () => {
      spinner.classList.add("active");

      const intensity = document.querySelector('input[name="intensity"]:checked').value;
      const zoom = document.getElementById("crop-zoom").value;

      const formData = new FormData();
      formData.append("intensity", intensity);
      formData.append("zoom", zoom);

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

        // Update URL state
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('intensity', intensity);
        newUrl.searchParams.set('zoom', zoom);
        window.history.replaceState({}, '', newUrl);

        // Start polling for completion
        startPollingReprocess(jobId, spinner, beforeImg, afterImg);

        // Reset feedback
        resetFeedbackUI();

      } catch (err) {
        alert(err.message);
        spinner.classList.remove("active");
      }
    });
  });

  async function startPollingReprocess(jobId, spinner, beforeImg, afterImg) {
    if (pollingInterval) clearTimeout(pollingInterval);

    try {
      const resp = await fetch(`${API_BASE_URL}/status/${jobId}`);
      if (!resp.ok) return;
      const data = await resp.json();

      if (data.status === "completed") {
        spinner.classList.remove("active");
        const t = Date.now();
        beforeImg.src = `${API_BASE_URL}/uploads/${jobId}/cropped_square.jpg?t=${t}`;
        afterImg.src = `${API_BASE_URL}/uploads/${jobId}/retouched.jpg?t=${t}`;
      } else if (data.status === "failed") {
        spinner.classList.remove("active");
        alert("Reprocessing failed: " + data.error);
      } else {
        pollingInterval = setTimeout(() => startPollingReprocess(jobId, spinner, beforeImg, afterImg), 2000);
      }
    } catch (e) {
      console.warn("Polling error", e);
      spinner.classList.remove("active");
    }
  }
}

function resetFeedbackUI() {
  const btnGood = document.getElementById("btn-good");
  const btnBad = document.getElementById("btn-bad");
  const confirmation = document.getElementById("feedback-confirmation");
  if (btnGood && btnBad && confirmation) {
    btnGood.classList.remove("selected");
    btnBad.classList.remove("selected");
    btnGood.disabled = false;
    btnBad.disabled = false;
    confirmation.hidden = true;
  }
}

/* ---- Feedback Rating ---- */
function initFeedback() {
  const btnGood = document.getElementById("btn-good");
  const btnBad = document.getElementById("btn-bad");
  const confirmation = document.getElementById("feedback-confirmation");
  if (!btnGood || !btnBad) return;

  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get("job_id");
  if (!jobId) return;

  function submitRating(rating) {
    // Immediate visual response
    btnGood.classList.remove("selected");
    btnBad.classList.remove("selected");
    if (rating === "good") btnGood.classList.add("selected");
    else btnBad.classList.add("selected");
    btnGood.disabled = true;
    btnBad.disabled = true;
    confirmation.hidden = false;

    // Fire and forget — silent network failure
    const formData = new FormData();
    formData.append("rating", rating);
    fetch(`${API_BASE_URL}/rate/${jobId}`, { method: "POST", body: formData }).catch(() => { });
  }

  btnGood.addEventListener("click", () => submitRating("good"));
  btnBad.addEventListener("click", () => submitRating("bad"));

  // Note: reset logic is now handled in `resetFeedbackUI` called by `initIntensityReprocess`
}
