/* SnapReady — Frontend Logic */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

// Change this to your Render URL later!
const API_BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:8000'
  : 'https://snap-ready.onrender.com';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBS48DoTQhpi_6MBl4P8C3yAvJJh3e-zlQ",
  authDomain: "yphoto-d4f64.firebaseapp.com",
  projectId: "yphoto-d4f64",
  storageBucket: "yphoto-d4f64.firebasestorage.app",
  messagingSenderId: "548696202902",
  appId: "1:548696202902:web:f295e4d694781d5e3cecb7",
  measurementId: "G-JG2Y1J4P52"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

let currentUser = null;

document.addEventListener("DOMContentLoaded", () => {
  // === Auth State Management ===
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    updateAuthUI(user);
    if (user) {
      // Re-initialize dynamic data when logged in
      const uploadForm = document.getElementById("upload-form");
      if (uploadForm) initGallery();

      const comparison = document.getElementById("comparison");
      if (comparison) initResultPage();
    }
  });

  const btnLogin = document.getElementById("btn-login");
  const btnLogout = document.getElementById("btn-logout");
  if (btnLogin) btnLogin.addEventListener("click", handleLogin);
  if (btnLogout) btnLogout.addEventListener("click", handleLogout);

  let authMode = "login"; // "login" or "signup"
  const tabLogin = document.getElementById("tab-login");
  const tabSignup = document.getElementById("tab-signup");
  const btnEmailSubmit = document.getElementById("btn-email-submit");
  const authError = document.getElementById("auth-error");

  if (tabLogin && tabSignup) {
    tabLogin.addEventListener("click", () => {
      authMode = "login";
      tabLogin.style.borderColor = "var(--accent)";
      tabLogin.style.color = "var(--text-primary)";
      tabSignup.style.borderColor = "var(--border)";
      tabSignup.style.color = "var(--text-secondary)";
      btnEmailSubmit.textContent = "Log In";
      if (authError) authError.hidden = true;
    });

    tabSignup.addEventListener("click", () => {
      authMode = "signup";
      tabSignup.style.borderColor = "var(--accent)";
      tabSignup.style.color = "var(--text-primary)";
      tabLogin.style.borderColor = "var(--border)";
      tabLogin.style.color = "var(--text-secondary)";
      btnEmailSubmit.textContent = "Create Account";
      if (authError) authError.hidden = true;
    });
  }

  const emailAuthForm = document.getElementById("email-auth-form");
  if (emailAuthForm) {
    emailAuthForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (authError) authError.hidden = true;
      const email = document.getElementById("auth-email").value;
      const password = document.getElementById("auth-password").value;

      try {
        btnEmailSubmit.disabled = true;
        btnEmailSubmit.textContent = "Please wait...";
        if (authMode === "login") {
          await signInWithEmailAndPassword(auth, email, password);
        } else {
          await createUserWithEmailAndPassword(auth, email, password);
        }
      } catch (error) {
        console.error("Email auth failed:", error);
        if (authError) {
          authError.textContent = error.message.replace("Firebase: ", "");
          authError.hidden = false;
        }
        btnEmailSubmit.disabled = false;
        btnEmailSubmit.textContent = authMode === "login" ? "Log In" : "Create Account";
      }
    });
  }

  // === Upload Page ===
  const uploadForm = document.getElementById("upload-form");
  if (uploadForm) {
    initUploadPage();
  }

  // === Result Page (comparison slider) ===
  const comparison = document.getElementById("comparison");
  if (comparison) {
    initComparisonSlider();
    initIntensityReprocess();
    initFeedback();
  }
});

/* ---- Auth Logic ---- */
async function handleLogin() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Login failed:", error);
    const authError = document.getElementById("auth-error");
    if (authError) {
      authError.textContent = error.message.replace("Firebase: ", "");
      authError.hidden = false;
    } else {
      alert("Could not log in. " + error.message);
    }
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    window.location.href = "/";
  } catch (error) {
    console.error("Logout failed:", error);
  }
}

function updateAuthUI(user) {
  const navUser = document.getElementById("nav-user");
  const userAvatar = document.getElementById("user-avatar");
  const gateMessage = document.getElementById("auth-gate-message");
  const uploadForm = document.getElementById("upload-form");
  const gallerySection = document.getElementById("gallery-section");

  if (user) {
    if (navUser) {
      navUser.hidden = false;
      userAvatar.src = user.photoURL || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%23333'/%3E%3Cpath d='M12 14c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5zm0-3c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3z' fill='%23fff'/%3E%3C/svg%3E";
    }
    if (gateMessage) gateMessage.hidden = true;
    if (uploadForm) uploadForm.hidden = false;
    // Gallery is handled in onAuthStateChanged
  } else {
    if (navUser) navUser.hidden = true;
    if (gateMessage) gateMessage.hidden = false;
    if (uploadForm) uploadForm.hidden = true;
    if (gallerySection) gallerySection.hidden = true;
  }
}

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
    if (!currentUser) return alert("You must be logged in to process photos.");

    errorBanner.hidden = true;
    spinner.classList.add("active");

    const formData = new FormData(form);
    const token = await currentUser.getIdToken();

    try {
      const resp = await fetch(`${API_BASE_URL}/process`, {
        method: "POST",
        body: formData,
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.detail || "Processing failed");
      }
      const data = await resp.json();
      JobHistory.add(data.job_id);

      // Reset form visually, but don't redirect yet
      spinner.classList.remove("active");
      const localDataUrl = previewImg.src; // Capture the local preview before clearing
      clearBtn.click();

      // Show in gallery and start polling with local preview
      addJobToGallery(data.job_id, "processing", null, localDataUrl);
      pollJob(data.job_id);

    } catch (err) {
      spinner.classList.remove("active");
      errorBanner.textContent = err.message;
      errorBanner.hidden = false;
    }
  });
}

/* ---- Gallery & Polling ---- */
async function initGallery() {
  const gallerySection = document.getElementById("gallery-section");
  // Create a new function to fetch history from the backend DB directly
  try {
    const token = await currentUser.getIdToken();
    const resp = await fetch(`${API_BASE_URL}/jobs`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (resp.ok) {
      const data = await resp.json();
      const jobs = Array.isArray(data) ? data : (data.jobs || []);

      if (jobs.length > 0) {
        gallerySection.hidden = false;
        // Keep a unified map of local ID vs remote
        const currentLocalIds = JobHistory.get();

        for (const job of jobs) {
          // If we didn't track it locally yet, add it
          if (!currentLocalIds.includes(job.job_id)) {
            JobHistory.add(job.job_id);
          }
          addJobToGallery(job.job_id, "completed", job);
        }

        // Let polling handle the local ones that are still processing
        const allIdsToPoll = JobHistory.get().filter(id => !jobs.find(j => j.job_id === id));
        allIdsToPoll.reverse().forEach(id => {
          addJobToGallery(id, "unknown");
          pollJob(id);
        });
      }
    }
  } catch (e) {
    console.error("Failed to load history from DB", e);
  }
}

function addJobToGallery(jobId, jobStatus, jobData = null, localDataUrl = null) {
  const section = document.getElementById("gallery-section");
  const grid = document.getElementById("gallery-grid");
  section.hidden = false;

  // Don't add duplicate
  if (document.getElementById(`job-${jobId}`)) {
    updateGalleryItem(jobId, jobStatus, jobData, localDataUrl);
    return;
  }

  const itemDiv = document.createElement("div");
  itemDiv.className = `gallery-item ${jobStatus}`;
  itemDiv.id = `job-${jobId}`;

  const thumbUrl = (jobStatus === "completed" && jobData && jobData.retouched_url)
    ? jobData.retouched_url
    : (localDataUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' fill='%231a1a1a'/%3E%3C/svg%3E");

  itemDiv.innerHTML = `
    <img src="${thumbUrl}" alt="Job ${jobId}">
    <div class="status-badge ${jobStatus}">${jobStatus}</div>
    <button class="gallery-delete-btn" title="Delete">&times;</button>
    ${jobStatus === 'processing' || jobStatus === 'unknown' ? '<div class="loader-bar"></div>' : ''}
  `;

  // Wire up delete button
  const deleteBtn = itemDiv.querySelector('.gallery-delete-btn');
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteJob(jobId, itemDiv);
  });

  if (jobStatus === "completed") {
    itemDiv.classList.add("clickable");
    itemDiv.addEventListener("click", () => {
      window.location.href = `/result.html?job_id=${jobId}`;
    });
  }

  grid.prepend(itemDiv); // Always prepend new jobs
}

function updateGalleryItem(jobId, status, jobData = null, localDataUrl = null) {
  const itemDiv = document.getElementById(`job-${jobId}`);
  if (!itemDiv) return;

  const img = itemDiv.querySelector("img");
  const loaderBar = itemDiv.querySelector(".loader-bar");
  const badge = itemDiv.querySelector(".status-badge");

  itemDiv.className = `gallery-item ${status}`;

  if (badge) {
    badge.className = `status-badge ${status}`;
    badge.textContent = status;
  }

  if (status === "completed") {
    if (loaderBar) loaderBar.remove();
    if (img && jobData && jobData.retouched_url) {
      img.src = jobData.retouched_url + `?t=${Date.now()}`; // bust cache
    }
    itemDiv.classList.add("clickable");
    itemDiv.onclick = () => {
      window.location.href = `/result.html?job_id=${jobId}`;
    };
    badge.textContent = "Ready";
  } else if (status === "failed" || status === "expired") {
    if (loaderBar) loaderBar.remove();
    itemDiv.classList.remove("clickable");
    itemDiv.onclick = null;
  } else if (status === "processing" || status === "unknown") {
    itemDiv.classList.remove("clickable");
    itemDiv.onclick = null;
    badge.textContent = "Processing...";
    if (localDataUrl && img) img.src = localDataUrl;
  }
}

async function deleteJob(jobId, itemDiv) {
  if (!currentUser) return;
  if (!confirm("Delete this headshot?")) return;

  try {
    const token = await currentUser.getIdToken();
    const resp = await fetch(`${API_BASE_URL}/jobs/${jobId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (resp.ok || resp.status === 404) {
      // If it's a 404, it's already deleted from the backend, so we safely remove it from the UI.
      itemDiv.style.transform = "scale(0.8)";
      itemDiv.style.opacity = "0";

      // Also clean up local storage history aggressively
      const localJobs = JobHistory.get().filter(id => id !== jobId);
      localStorage.setItem('snapready_jobs', JSON.stringify(localJobs));

      setTimeout(() => {
        itemDiv.remove();
        const grid = document.getElementById("gallery-grid");
        if (grid && grid.children.length === 0) {
          document.getElementById("gallery-section").hidden = true;
        }
      }, 300);
    } else {
      alert("Failed to delete. Please try again.");
    }
  } catch (e) {
    console.error("Delete failed", e);
    alert("Failed to delete. Please try again.");
  }
}

async function pollJob(jobId) {
  if (!currentUser) return;

  try {
    const token = await currentUser.getIdToken();
    const resp = await fetch(`${API_BASE_URL}/status/${jobId}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    // If the backend says 404, the job files were deleted (e.g. Render server restarted)
    if (resp.status === 404) {
      updateGalleryItem(jobId, "expired", null);

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

    updateGalleryItem(jobId, data.status, data);

    if (data.status === "processing") {
      setTimeout(() => pollJob(jobId), 2000);
    }
  } catch (e) {
    console.warn("Polling error", e);
  }
}

/* ---- Result Page Init ---- */
async function initResultPage() {
  const urlParams = new URLSearchParams(window.location.search);
  let jobId = urlParams.get('job_id');

  if (!jobId) {
    window.location.href = '/';
    return;
  }

  if (!currentUser) {
    // Must establish auth first. Let onAuthStateChanged handle this.
    return;
  }

  const spinner = document.getElementById("spinner-overlay"); // Changed from reprocessing-spinner
  const beforeImg = document.getElementById("before-img"); // Changed from img-before
  const afterImg = document.getElementById("after-img"); // Changed from img-after

  try {
    spinner.classList.add("active");
    const token = await currentUser.getIdToken();
    const resp = await fetch(`${API_BASE_URL}/status/${jobId}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!resp.ok) throw new Error("Could not load job status.");
    const data = await resp.json();

    // ALWAYS restore images from backend data if available
    if (data.cropped_url && data.retouched_url) {
      beforeImg.src = data.cropped_url + "?t=" + new Date().getTime();
      afterImg.src = data.retouched_url + "?t=" + new Date().getTime();
    }

    // ALWAYS restore controls from backend data if available
    const savedIntensity = data.intensity || 'medium';
    const savedZoom = data.zoom || '1.0';

    const radio = document.querySelector(`input[name="intensity"][value="${savedIntensity}"]`);
    if (radio) radio.checked = true;

    const zoomSlider = document.getElementById("crop-zoom");
    if (zoomSlider) {
      zoomSlider.value = savedZoom;
      zoomSlider.dataset.savedZoom = savedZoom; // Store baseline for relative preview calculations
      beforeImg.style.transform = "";
      afterImg.style.transform = "";
    }

    if (data.status === "completed") {
      spinner.classList.remove("active");
      // Update download link
      const dlLink = document.getElementById("download-btn");
      dlLink.href = `${API_BASE_URL}/download/${jobId}?token=${token}`;
    } else if (data.status === "processing") {
      pollResultPage(jobId);
    } else if (data.status === "failed") {
      spinner.classList.remove("active");
      alert("This job failed to process.");
    }
  } catch (error) {
    console.error("Error loading result:", error);
    spinner.classList.remove("active");
  }
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
  const intensityControls = document.querySelectorAll('input[name="intensity"]');
  const zoomSlider = document.getElementById("crop-zoom");
  const spinner = document.getElementById("spinner-overlay");
  const beforeImg = document.getElementById("before-img");
  const afterImg = document.getElementById("after-img");
  let reprocessTimeout;
  let pollingInterval;

  // --- Intensity radios: immediate reprocess ---
  intensityControls.forEach((radio) => {
    radio.addEventListener("change", async () => {
      if (!currentUser) return alert("You must be logged in to reprocess.");
      spinner.classList.add("active");
      await triggerReprocess();
    });
  });

  // --- Zoom slider: live CSS preview + debounced reprocess ---
  if (zoomSlider) {
    // Live preview on input (while dragging)
    zoomSlider.addEventListener("input", () => {
      const currentZoom = parseFloat(zoomSlider.value);
      const savedZoom = parseFloat(zoomSlider.dataset.savedZoom || "1.0");

      // Calculate RELATIVE scale. If saved was 1.5 (wide) and we drag to 1.0 (tight), we zoom in (1.5x scale)
      const scale = savedZoom / currentZoom;
      beforeImg.style.transform = `scale(${scale})`;
      afterImg.style.transform = `scale(${scale})`;
    });

    // Debounced reprocess on change (when user releases slider)
    zoomSlider.addEventListener("change", async () => {
      if (!currentUser) return;
      clearTimeout(reprocessTimeout);

      // Show a subtle processing indicator on the images
      beforeImg.style.filter = "brightness(0.6)";
      afterImg.style.filter = "brightness(0.6)";
      spinner.classList.add("active");

      reprocessTimeout = setTimeout(async () => {
        await triggerReprocess();
        // Reset transforms after server sends back the properly cropped images
        beforeImg.style.transform = "";
        afterImg.style.transform = "";
        beforeImg.style.filter = "";
        afterImg.style.filter = "";
      }, 300);
    });
  }

  async function triggerReprocess() {
    const intensity = document.querySelector('input[name="intensity"]:checked').value;
    const zoom = zoomSlider ? zoomSlider.value : '1.0';

    const formData = new FormData();
    formData.append("intensity", intensity);
    formData.append("zoom", zoom);

    const urlParams = new URLSearchParams(window.location.search);
    const jobId = urlParams.get('job_id');
    const token = await currentUser.getIdToken();

    try {
      const resp = await fetch(`${API_BASE_URL}/reprocess/${jobId}`, {
        method: "POST",
        body: formData,
        headers: { "Authorization": `Bearer ${token}` }
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
      beforeImg.style.transform = "";
      afterImg.style.transform = "";
      beforeImg.style.filter = "";
      afterImg.style.filter = "";
    }
  }

  async function startPollingReprocess(jobId, spinner, beforeImg, afterImg) {
    if (pollingInterval) clearTimeout(pollingInterval);
    if (!currentUser) return;

    try {
      const token = await currentUser.getIdToken();
      const resp = await fetch(`${API_BASE_URL}/status/${jobId}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!resp.ok) return;
      const data = await resp.json();

      if (data.status === "completed") {
        spinner.classList.remove("active");
        if (data.cropped_url && data.retouched_url) {
          beforeImg.src = data.cropped_url + "?t=" + new Date().getTime();
          afterImg.src = data.retouched_url + "?t=" + new Date().getTime();

          beforeImg.style.transform = "";
          afterImg.style.transform = "";

          if (data.zoom) {
            const zoomSlider = document.getElementById("crop-zoom");
            if (zoomSlider) zoomSlider.dataset.savedZoom = data.zoom;
          }
        }
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

  async function submitRating(rating) {
    if (!currentUser) return;
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
    const token = await currentUser.getIdToken();

    fetch(`${API_BASE_URL}/rate/${jobId}`, {
      method: "POST",
      body: formData,
      headers: { "Authorization": `Bearer ${token}` }
    }).catch(() => { });
  }

  btnGood.addEventListener("click", () => submitRating("good"));
  btnBad.addEventListener("click", () => submitRating("bad"));

  // Note: reset logic is now handled in `resetFeedbackUI` called by `initIntensityReprocess`
}
