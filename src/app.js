(function() {
    'use strict';
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
    
    function initApp() {
        const { createClient } = supabase;
        const supabaseUrl = 'https://gfylsjfljnwyomfouwvs.supabase.co';
        const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmeWxzamZsam53eW9tZm91d3ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0MDc5MTYsImV4cCI6MjA3Mjk4MzkxNn0.hMvLvCDVaFtq0rXToHGOJPSFe-QnJ6_S-MYsI0d5zOs';
        const sb = createClient(supabaseUrl, supabaseKey);

        // --- Google Drive API Configuration ---
        const CLIENT_ID = '903962440902-olb0km18p980o04na5hi4ah4f6lanms1.apps.googleusercontent.com'; // Paste your OAuth 2.0 Client ID here
        const API_KEY = 'AIzaSyDq39bo-QQRWbPWM0qWcolswBdkBpiLR3w'; // Paste your API Key here
        const PARENT_FOLDER_ID = '1jmD_XBl_4a_FEvT3xQ9RKgH7-26gmM30'; // Paste your Google Drive Folder ID here
        const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
        const SCOPES = 'https://www.googleapis.com/auth/drive.file';

        let tokenClient;
        let gapiInited = false;
        let gisInited = false;
		let hasCustomerApproval = false;
		

        // ADD THIS ENTIRE BLOCK
        // Global error handler for unhandled promise rejections.
        window.addEventListener('unhandledrejection', function(event) {
            console.error('Unhandled Promise Rejection:', event.reason);
            let errorMessage = 'An unexpected error occurred. Please try again.';
            
            // Try to provide a more specific message for network errors
            if (event.reason instanceof Error) {
                if (event.reason.message.toLowerCase().includes('failed to fetch') || event.reason.message.toLowerCase().includes('network')) {
                     errorMessage = 'Network error. Please check your connection.';
                } else {
                    // Show the actual technical error if it's not a generic network one
                    errorMessage = event.reason.message;
                }
            }
            
            showError(errorMessage);
            // Prevents the default browser action of logging the error to the console (we already did it).
            event.preventDefault();
        });
        // END OF NEW BLOCK
		
		

        // --- Google API Client Loader Functions ---
// Auto-detect when Google API loads
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
            if (resp.error !== undefined) {
                showError('Authorization failed. Please try again.');
                throw (resp);
            }
            updateAuthUI(true);
            showSuccessMessage('Google Drive access authorized.');
        },
    });
    gisInited = true;
    checkInitialAuth();
}

// Expose to window for Google scripts
window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;

// Poll for Google APIs to load
const checkGoogleAPIs = setInterval(() => {
    if (typeof gapi !== 'undefined' && !gapiInited) {
        gapiLoaded();
    }
    if (typeof google !== 'undefined' && google.accounts && !gisInited) {
        gisLoaded();
    }
    if (gapiInited && gisInited) {
        clearInterval(checkGoogleAPIs);
    }
}, 100);


        // --- Global State ---
        let currentUser = null;
        let vehicleModelsCache = [];
        let reportsDataStore = {};
        let updateableReportsStore = {};
        let currentVehicleId = null;
        let currentReportId = null;
        let originalComplaintsForUpdate = [];
		let newSuggestions = [];
		let appSettings = {};
        
        let currentComplaints = []; 
        let currentOdometer = 0; 
        let originalClientName = '';
        let originalClientPhone = '';
        let damageMarks = [];
        let uploadedImageFile = null;

        // Media recording state
        let capturedPhotos = [];
        let voiceNoteBlob = null;
        let mediaRecorder;
        let audioChunks = [];
        
        // --- UI Element References ---
        const vehicleDetailsSection = document.getElementById('vehicle-details-section'), createVehicleSection = document.getElementById('create-vehicle-section'), newComplaintSection = document.getElementById('new-complaint-section'), searchError = document.getElementById('search-error');
        const predictionList = document.getElementById('prediction-list'), updateDetailsSection = document.getElementById('update-details-section'), updateFormSection = document.getElementById('update-form-section');

        // --- Canvas-related variables ---
        let carImage, damageCanvas, checkCanvas, damageCtx, checkCtx;

        // --- OCR SCANNER FUNCTIONS (using OCR.space API) ---
        
        /**
         * Resizes and compresses an image file before uploading, ensuring the correct file extension.
         * @param {File} file The original image file.
         * @returns {Promise<File>} A promise that resolves with the new, smaller JPEG image file.
         */
        function resizeImage(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const MAX_WIDTH = 1280; // Set a max width for efficiency
                        const scaleSize = MAX_WIDTH / img.width;
                        canvas.width = MAX_WIDTH;
                        canvas.height = img.height * scaleSize;

                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                        canvas.toBlob((blob) => {
                            if (blob) {
                                // FIX: Create a new filename with .jpg extension to match the blob type
                                const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                                const newFileName = `${baseName}.jpg`;
                                resolve(new File([blob], newFileName, { type: 'image/jpeg', lastModified: Date.now() }));
                            } else {
                                reject(new Error('Canvas to Blob conversion failed'));
                            }
                        }, 'image/jpeg', 0.85); // Compress to 85% quality
                    };
                    img.onerror = reject;
                    img.src = event.target.result;
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

        /**
         * Calls the OCR.space API to perform text recognition on an image file.
         * @param {File} imageFile The image file to be analyzed.
         * @returns {Promise<string>} A promise that resolves with the detected text.
         */
        async function callOcrSpaceAPI(imageFile) {
            const statusEl = document.getElementById('scanner-status');
            statusEl.innerHTML = `
                <svg class="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span>Analyzing with OCR...</span>`;
            
            const formData = new FormData();
            formData.append('file', imageFile);
            // Using the free "helloworld" API key for demonstration. 
            // For a production app, get your own free key from OCR.space.
            formData.append('apikey', 'helloworld');
            formData.append('language', 'eng');
            formData.append('ocrengine', 2); // Engine 2 is often better for single blocks of text.

            const response = await fetch('https://api.ocr.space/parse/image', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }

            const result = await response.json();

            if (result.IsErroredOnProcessing) {
                throw new Error(result.ErrorMessage.join(' '));
            }
            
            if (result.ParsedResults && result.ParsedResults.length > 0) {
                 return result.ParsedResults[0].ParsedText;
            } else {
                return ''; // No text found
            }
        }


        /**
         * Finds the most likely Indian vehicle number plate from raw OCR text.
         * @param {string} text Raw text from the OCR API.
         * @returns {string|null} The best matching number plate or null.
         */
        function findBestMatchForPlate(text) {
            if (!text) return null;
            // Clean the text by removing spaces, newlines, and common misread characters.
            const cleanedText = text.replace(/[\s\n\r\t.,!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/g, '').toUpperCase();
            
            // Regex patterns for common Indian number plates. Ordered from most to least specific.
            const patterns = [
                /\d{2}BH\d{4}[A-Z]{2}/,      // BH Series: 21BH2345AA
                /[A-Z]{2}\d{1,2}[A-Z]{1,2}\d{4}/, // Standard format like DL8CAC4194 or KA19P8488
                /[A-Z]{2}\d{2}[A-Z]{1,2}\d{3}/, // e.g., TN37C987
                /[A-Z]{2}\d{2}[A-Z]{1,2}\d{1,4}/, // Generic catch-all
            ];

            for (const pattern of patterns) {
                const match = cleanedText.match(pattern);
                if (match) {
                    return match[0]; // Return the first valid format found
                }
            }
            return null; // No valid format found
        }

        async function handleImageUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            showModal('scanner-modal');
            const statusEl = document.getElementById('scanner-status');
            const analyzeBtn = document.getElementById('analyze-btn');
            analyzeBtn.disabled = true;
            statusEl.innerHTML = `
                <svg class="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span>Processing image...</span>`;

            try {
                // Resize the image before doing anything else
                const resizedFile = await resizeImage(file);
                uploadedImageFile = resizedFile; // Store the resized file

                const reader = new FileReader();
                reader.onload = function(e) {
                    const imagePreview = document.getElementById('scanner-image-preview');
                    imagePreview.src = e.target.result;
                    statusEl.textContent = 'Image loaded. Click below to analyze.';
                    analyzeBtn.disabled = false;
                };
                reader.readAsDataURL(resizedFile);
            } catch (error) {
                console.error("Image processing error:", error);
                showError("Could not process the selected image.");
                closeScannerModal();
            }
            
            event.target.value = ''; // Reset file input
        }

        function closeScannerModal() {
            const imagePreview = document.getElementById('scanner-image-preview');
            imagePreview.src = '';
            uploadedImageFile = null;
            hideModal('scanner-modal');
        }

        async function analyzeImageWithAPI() {
            if (!uploadedImageFile) {
                showError("No image selected to process.");
                return;
            }

            const analyzeBtn = document.getElementById('analyze-btn');
            analyzeBtn.disabled = true;

            try {
                const textFromAPI = await callOcrSpaceAPI(uploadedImageFile);
                const bestMatch = findBestMatchForPlate(textFromAPI);
                
                if (bestMatch) {
                    const finalNumber = normalizeVehicleNumber(bestMatch);
                    document.getElementById('search-vehicle-number').value = finalNumber;
                    showSuccessMessage(`Detected: ${finalNumber}`);
                    closeScannerModal();
                    searchVehicle(); // Automatically search
                } else {
                    showError('Could not find a valid number plate in the image.');
                    document.getElementById('scanner-status').textContent = 'No number plate found. Try a clearer shot.';
                    analyzeBtn.disabled = false;
                }

            } catch (error) {
                console.error("API Error:", error);
                showError("An error occurred during analysis: " + error.message);
                document.getElementById('scanner-status').textContent = 'An error occurred. Please try again.';
                analyzeBtn.disabled = false;
            }
        }
        
        // --- Media Upload & Recording Functions ---

        function handlePhotoUploads(event) {
            const newFiles = event.target.files;
            if (!newFiles) return;
            // Add the newly selected files to our existing array
            capturedPhotos.push(...Array.from(newFiles));
            renderPhotoPreviews();
            // Reset the input so the user can add the same file again if they remove it
            event.target.value = '';
        }
        
        function renderPhotoPreviews() {
            const previewsContainer = document.getElementById('photo-previews');
            previewsContainer.innerHTML = ''; // Clear all previews to re-render
            if (capturedPhotos.length === 0) return;
            capturedPhotos.forEach((file, index) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const previewWrapper = document.createElement('div');
                    previewWrapper.className = 'relative aspect-square group';
                    previewWrapper.innerHTML = `
                        <img src="${e.target.result}" class="w-full h-full object-cover rounded-lg">
                        <button onclick="removePhoto(${index})" class="absolute top-1 right-1 bg-red-600/80 text-white rounded-full h-6 w-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="material-symbols-outlined text-sm">close</span>
                        </button>
                    `;
                    previewsContainer.appendChild(previewWrapper);
                };
                reader.readAsDataURL(file);
            });
        }

        function removePhoto(indexToRemove) {
            // Remove the photo from our array at the specified index
            capturedPhotos.splice(indexToRemove, 1);
            // Re-render the previews to reflect the change
            renderPhotoPreviews();
        }

        function handleCustomerApprovalRecordingToggle() {
            if (mediaRecorder && mediaRecorder.state === "recording") {
                stopRecording('customer');
            } else {
                startRecording('customer');
            }
        }
		

function handleCheckboxChange(checkbox) {
    // This helper function re-renders the list to show/hide the materials input correctly.
    const reRenderList = () => {
        const approvedItems = [];
        // Get the current list of approved items directly from the checkboxes
        document.querySelectorAll('#customer-approval-list input[type="checkbox"]:checked').forEach(cb => {
            try { 
                approvedItems.push(JSON.parse(cb.value)); 
            } catch (e) {
                console.error("Error parsing checkbox value on change:", e);
            }
        });
        // Call the main render function with the current state and the new approved list
        renderSuggestions(originalComplaintsForUpdate, newSuggestions, approvedItems);
    };

    if (hasCustomerApproval) {
        showModal('change-confirmation-modal');
        const confirmBtn = document.getElementById('confirm-change-button');
        const cancelBtn = document.getElementById('cancel-change-button');

        confirmBtn.onclick = () => {
            hideModal('change-confirmation-modal');
            reRenderList(); // Re-render the list after user confirmation
        };
        cancelBtn.onclick = () => {
            checkbox.checked = !checkbox.checked; // Revert the checkbox if the user cancels
            hideModal('change-confirmation-modal');
        };
    } else {
        reRenderList(); // If customer hasn't approved yet, just re-render directly
    }
}




        function handleRecordingToggle() {
            if (mediaRecorder && mediaRecorder.state === "recording") {
                stopRecording('executive'); 
            } else {
                startRecording('executive');
            }
        }

        async function startRecording(context = 'executive') {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                showError('Audio recording is not supported on this browser.');
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];

                mediaRecorder.addEventListener("dataavailable", event => {
                    audioChunks.push(event.data);
                });

                mediaRecorder.addEventListener("stop", () => {
                    voiceNoteBlob = new Blob(audioChunks, { 'type' : 'audio/webm' });
                    const audioUrl = URL.createObjectURL(voiceNoteBlob);
                    const audioPlaybackEl = context === 'customer' ? 'customer-audio-playback' : 'audio-playback';
                    document.getElementById(audioPlaybackEl).innerHTML = `<audio controls src="${audioUrl}" class="w-full"></audio>`;
                });

                mediaRecorder.start();
                
                if (context === 'executive') {
                    const recordBtn = document.getElementById('record-toggle-btn');
                    const recordIcon = document.getElementById('record-icon');
                    const recordText = document.getElementById('record-text');
                    recordBtn.classList.add('is-recording');
                    recordBtn.classList.remove('btn-secondary');
                    recordIcon.textContent = 'stop_circle';
                    recordText.textContent = 'Stop';
                    document.getElementById('recording-status').textContent = 'Recording...';
                } else { // Logic for customer page
                    const recordBtn = document.getElementById('cust-approval-record-btn');
                    const recordIcon = document.getElementById('cust-approval-record-icon');
                    const recordText = document.getElementById('cust-approval-record-text');
                    recordBtn.classList.add('is-recording');
                    recordBtn.classList.remove('btn-secondary');
                    recordIcon.textContent = 'stop_circle';
                    recordText.textContent = 'Stop';
                    document.getElementById('customer-recording-status').textContent = 'Recording...';
                }

            } catch (err) {
                showError('Microphone access was denied.');
                console.error("Mic Error:", err);
            }
        }

        function stopRecording(context = 'executive') {
            if (mediaRecorder) {
                mediaRecorder.stop();
                
                if (context === 'executive') {
                    const recordBtn = document.getElementById('record-toggle-btn');
                    const recordIcon = document.getElementById('record-icon');
                    const recordText = document.getElementById('record-text');
                    recordBtn.classList.remove('is-recording');
                    recordBtn.classList.add('btn-secondary');
                    recordIcon.textContent = 'mic';
                    recordText.textContent = 'Record Note';
                    document.getElementById('recording-status').textContent = 'Recording stopped.';
                } else { // Logic for customer page
                    const recordBtn = document.getElementById('cust-approval-record-btn');
                    const recordIcon = document.getElementById('cust-approval-record-icon');
                    const recordText = document.getElementById('cust-approval-record-text');
                    recordBtn.classList.remove('is-recording');
                    recordBtn.classList.add('btn-secondary');
                    recordIcon.textContent = 'mic';
                    recordText.textContent = 'Record';
                    document.getElementById('customer-recording-status').textContent = 'Recording stopped.';
                }
            }
        }

        // --- AUTHENTICATION & UTILITIES ---
        const normalizeVehicleNumber = (num) => {
            if (!num) return '';
            const cleaned = num.replace(/[\s\W_]+/g, '').toUpperCase();
            const match = cleaned.match(/^([A-Z]{2})(\d{1,2})([A-Z]{1,2})(\d{1,4})$/);
            if (match) {
                const state = match[1];
                let rto = match[2];
                const series = match[3];
                let number = match[4];
                if (rto.length === 1) rto = '0' + rto;
                return `${state}${rto}${series}${number}`;
            }
            return cleaned;
        };

async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    if (!username || !password) return showError('Username and password are required.');

    const { data, error } = await sb
        .from('users')
        .select('*')
        .ilike('username', username)
        .single();

    if (error || !data || data.password !== password) {
        return showError('Invalid credentials.');
    }
    
    currentUser = data;
    sessionStorage.setItem('currentUser', JSON.stringify(currentUser)); 
    
    if (currentUser.role === 'admin') {
        showAdminScreen('admin-dashboard-screen');
    } else if (currentUser.role === 'executive') {
        document.getElementById('profile-username').textContent = currentUser.username;
        document.getElementById('profile-role').textContent = currentUser.role;
        await fetchAndApplyAppSettings(); 
        showExecutiveScreen('job-card-screen');
        setTimeout(checkInitialAuth, 1000);
    } else if (currentUser.role === 'washer') {
        showScreen('washer-screen');
        populateWashList();
    } else if (currentUser.role === 'inspector') { // ADDED THIS BLOCK
        showScreen('inspector-screen');
        populateInspectionQueue();
    } else {
        return showError('Unknown user role.');
    }
    showSuccessMessage(`Welcome, ${currentUser.username}!`);
}
		
// ADD NEW FUNCTION: Populates the list for the washer
// REPLACE this function
async function populateWashList() {
    const listContainer = document.getElementById('wash-queue-list');
    const noJobsMsg = document.getElementById('no-wash-jobs-message');
    listContainer.innerHTML = '';
    noJobsMsg.classList.add('hidden');

    const query = sb.from('reports')
        .select(`
            id,
            vehicles!inner(vehicle_no, vehicle_name, color, vehicle_models(brand, model)),
            executive:executive_id(username)
        `)
        .eq('status', 'Sent To Wash')
        .order('created_at', { ascending: true });
    const reports = await handleSupabaseQuery(query, 'Could not fetch wash queue.');
    if (reports === null) return;
    if (reports.length === 0) {
        noJobsMsg.classList.remove('hidden');
        return;
    }
    reports.forEach(report => {
        const card = document.createElement('div');
        const vehicle = report.vehicles;
        const executive = report.executive;
        const brandAndModel = `${vehicle.vehicle_models.brand || ''} ${vehicle.vehicle_models.model || ''}`.trim();
        
        // THE FIX: Added classes to make the card stack vertically on mobile
        card.className = 'p-4 border border-gray-200 rounded-lg flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3';
        
        // THE FIX: Added responsive width to the button and aligned text left on mobile
        card.innerHTML = `
            <div class="w-full sm:w-auto text-left">
                <p class="font-bold text-gray-800">${vehicle.vehicle_no}</p>
                <p class="text-sm text-gray-600 mt-1">${brandAndModel}</p>
                <p class="text-xs text-gray-500 mt-1">From: ${executive?.username || 'N/A'}</p>
            </div>
            <button onclick="completeWash(${report.id})" class="btn-primary w-full sm:w-auto flex-shrink-0 !py-2 !px-3">
                <span class="material-symbols-outlined">check_circle</span>
                <span>Wash Completed</span>
            </button>
        `;
        listContainer.appendChild(card);
    });
}

        // ADD NEW FUNCTION: Washer marks a job as done
        async function completeWash(reportId) {
            const { error } = await sb.from('reports')
                .update({ status: 'Wash Completed' })
                .eq('id', reportId);
            
            if (error) {
                return showError(`Failed to update status: ${error.message}`);
            }

            showSuccessMessage('Status updated. Vehicle sent back to executive.');
            populateWashList();
        }



function logout() {
    const originalAdmin = sessionStorage.getItem('originalAdmin');
    
    if (originalAdmin) {
        currentUser = JSON.parse(originalAdmin);
        sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
        sessionStorage.removeItem('originalAdmin');
        showAdminScreen('admin-dashboard-screen');
        showSuccessMessage('Returned to admin dashboard');
    } else {
        currentUser = null;
        sessionStorage.removeItem('currentUser');
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        
        // Safely sign out of Google Drive if available
        if (typeof gapi !== 'undefined' && gapi.client && gapi.client.getToken) {
            handleSignoutClick();
        }
        
        showScreen('login-screen');
    }
}
		

        function handleDateChange(fromId, toId) {
            const fromDateInput = document.getElementById(fromId);
            const toDateInput = document.getElementById(toId);

            if (fromDateInput.value) {
                toDateInput.min = fromDateInput.value;
            }

            if (toDateInput.value) {
                fromDateInput.max = toDateInput.value;
            }
        }
        // --- ADMIN: VEHICLE MANAGEMENT ---
        async function renderVehicleModelList() {
            const { data, error } = await sb.from('vehicle_models').select('*').order('brand');
            if (error) return showError('Could not fetch vehicle models.');
            
            vehicleModelsCache = data; 
            const list = document.getElementById('vehicle-models-list');
            list.innerHTML = '';
            if (data.length === 0) {
                list.innerHTML = `<p class="text-sm text-gray-500">No vehicle models created yet.</p>`;
                return;
            }
            data.forEach(item => {
                const div = document.createElement('div');
                div.className = 'flex items-center justify-between bg-gray-50 p-3 rounded-lg';
                div.innerHTML = `<p class="font-semibold">${item.brand} - ${item.model}</p><button onclick="confirmDeletion('vehicle_model', ${item.id})" class="text-red-500 hover:text-red-700"><span class="material-symbols-outlined">delete</span></button>`;
                list.appendChild(div);
            });
        }
		

// ADD NEW FUNCTION: Handles tab switching on the Close page
// Replace your showCloseTab function with this new 4-tab version
function showCloseTab(tabName) {
    const allTabs = ['ready-to-close', 'inspection-pending', 'wash-pending', 'complete'];
    
    allTabs.forEach(tab => {
        const btn = document.getElementById(`tab-btn-${tab}`);
        const panel = document.getElementById(`${tab}-panel`);
        if (btn) btn.classList.remove('active-tab');
        if (panel) panel.classList.add('hidden');
    });

    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    const activePanel = document.getElementById(`${tabName}-panel`);
    if (activeBtn) activeBtn.classList.add('active-tab');
    if (activePanel) activePanel.classList.remove('hidden');

    // Call the correct function to populate the active tab
    if (tabName === 'ready-to-close') populateReadyToCloseJobs();
    if (tabName === 'inspection-pending') populateInspectionPendingJobs();
    if (tabName === 'wash-pending') populateWashPendingJobs();
    if (tabName === 'complete') populateCompletedWashJobs();
}

// Add this new function to power the "Ready to Close" tab
// REPLACE this function
async function populateReadyToCloseJobs() {
    if (!currentUser) return;
    const listContainer = document.getElementById('ready-to-close-list');
    const noJobsMsg = document.getElementById('no-ready-to-close-message');
    
    if (!listContainer || !noJobsMsg) return console.error("Ready to close elements not found.");

    listContainer.innerHTML = '';
    noJobsMsg.classList.add('hidden');

    const { data: reports, error } = await sb.from('reports')
        .select(`id, vehicles!inner(vehicle_no, vehicle_models(brand, model))`)
        .eq('executive_id', currentUser.id)
        .eq('status', 'Ongoing')
        .not('approved', 'is', null)
        .neq('approved', '[]');

    if (error) return showError('Could not fetch ready jobs.');

    if (!reports || reports.length === 0) {
        noJobsMsg.classList.remove('hidden');
        return;
    }

    reports.forEach(report => {
        const card = document.createElement('div');
        // THE FIX: Added optional chaining (?.) to safely access brand and model
        const brandAndModel = `${report.vehicles.vehicle_models?.brand || ''} ${report.vehicles.vehicle_models?.model || ''}`.trim();
        
        card.className = 'p-4 border border-gray-200 rounded-lg flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3';
        card.innerHTML = `
            <div class="w-full text-left">
                <p class="font-bold text-gray-800">${report.vehicles.vehicle_no}</p>
                <p class="text-sm text-gray-600">${brandAndModel}</p>
            </div>
            <div class="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto flex-shrink-0">
                <button onclick="updateJobStatus(${report.id}, 'pending_inspection', '${report.vehicles.vehicle_no}')" class="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-1.5 px-3 rounded text-sm w-full sm:w-auto">
                    Send for Inspection
                </button>
                <button onclick="updateJobStatus(${report.id}, 'Sent To Wash', '${report.vehicles.vehicle_no}')" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-3 rounded text-sm w-full sm:w-auto">
                    Skip & Wash
                </button>
            </div>
        `;
        listContainer.appendChild(card);
    });
}

function populateDueDateScreen() {
            // Call the population function for each tab on the "Close" screen
            populateReadyToCloseJobs();
            populateInspectionPendingJobs();
            populateWashPendingJobs();
            populateCompletedWashJobs();
        }
		

// REPLACE this function
function showInspectionDetails(report) {
    document.getElementById('inspector-modal-vehicle-no').textContent = report.vehicles.vehicle_no;
    document.getElementById('inspector-modal-executive').textContent = report.executive?.username || 'N/A';

    const complaintsList = document.getElementById('inspector-modal-complaints');
    complaintsList.innerHTML = '';
    const complaints = JSON.parse(report.complaint || '[]');
    if (complaints.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'list-disc list-inside space-y-1';
        complaints.forEach(c => {
            const li = document.createElement('li');
            li.textContent = c.text || c;
            ul.appendChild(li);
        });
        complaintsList.appendChild(ul);
    } else {
        complaintsList.innerHTML = '<p class="italic">No complaints registered.</p>';
    }

    const suggestionsList = document.getElementById('inspector-modal-suggestions');
    suggestionsList.innerHTML = '';
    const suggestions = JSON.parse(report.suggested || '[]');
     if (suggestions.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'list-disc list-inside space-y-1';
        suggestions.forEach(s => {
            const li = document.createElement('li');
            li.textContent = `${s.text} (₹${s.amount || 0})`;
            ul.appendChild(li);
        });
        suggestionsList.appendChild(ul);
    } else {
        suggestionsList.innerHTML = '<p class="italic">No mechanic suggestions added yet.</p>';
    }

    const actionsContainer = document.getElementById('inspector-modal-actions');
    // THE FIX: Added w-full sm:w-auto to make buttons responsive
    actionsContainer.innerHTML = `
        <button onclick="handleInspection('${report.id}', 'rejected', '${report.vehicles.vehicle_no}')" class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded w-full sm:w-auto">
            Reject
        </button>
        <button onclick="handleInspection('${report.id}', 'inspection_approved', '${report.vehicles.vehicle_no}')" class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded w-full sm:w-auto">
            Approve
        </button>
    `;
    
    showModal('inspector-details-modal');
}


// Add this new function anywhere in your <script> tag
// REPLACE this function
async function populateInspectionPendingJobs() {
    if (!currentUser) return;
    const rejectedList = document.getElementById('rejected-jobs-list');
    const noRejectedMsg = document.getElementById('no-rejected-jobs-message');
    const pendingList = document.getElementById('pending-inspection-list');
    const noPendingMsg = document.getElementById('no-inspection-pending-message');

    if (!rejectedList || !noRejectedMsg || !pendingList || !noPendingMsg) {
        return console.error("Required elements for inspection tab are missing.");
    }

    rejectedList.innerHTML = '';
    pendingList.innerHTML = '';
    noRejectedMsg.classList.add('hidden');
    noPendingMsg.classList.add('hidden');

    const { data: rejectedReports, error: rejectedError } = await sb.from('reports')
        .select(`id, inspection_remarks, vehicles!inner(vehicle_no, vehicle_models(brand, model)), inspector:inspector_id(username)`)
        .eq('executive_id', currentUser.id)
        .eq('status', 'rejected');
    
    if (rejectedError) showError('Could not fetch rejected jobs.');
    
    if (rejectedReports && rejectedReports.length > 0) {
        rejectedReports.forEach(report => {
            const card = document.createElement('div');
            // THE FIX: Added optional chaining (?.)
            const brandAndModel = `${report.vehicles.vehicle_models?.brand || ''} ${report.vehicles.vehicle_models?.model || ''}`.trim();
            card.className = 'p-4 border border-red-300 bg-red-50 rounded-lg';
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <div>
                        <p class="font-bold text-gray-800">${report.vehicles.vehicle_no}</p>
                        <p class="text-sm text-gray-600">${brandAndModel}</p>
                    </div>
                    <button onclick="resendForInspection(${report.id})" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded text-sm flex-shrink-0">
                        Resend for Inspection
                    </button>
                </div>
                <div class="mt-2 pt-2 border-t border-red-200">
                    <p class="text-sm text-red-800 font-semibold">Remarks from ${report.inspector?.username || 'Inspector'}:</p>
                    <p class="text-sm text-gray-600 italic">"${report.inspection_remarks || 'No remarks provided.'}"</p>
                </div>
            `;
            rejectedList.appendChild(card);
        });
    } else {
        noRejectedMsg.classList.remove('hidden');
    }

    const { data: pendingReports, error: pendingError } = await sb.from('reports')
        .select(`id, vehicles!inner(vehicle_no, vehicle_models(brand, model))`)
        .eq('executive_id', currentUser.id)
        .eq('status', 'pending_inspection');
    
    if (pendingError) showError('Could not fetch pending jobs.');

    if (pendingReports && pendingReports.length > 0) {
        pendingReports.forEach(report => {
            const card = document.createElement('div');
            // THE FIX: Added optional chaining (?.)
            const brandAndModel = `${report.vehicles.vehicle_models?.brand || ''} ${report.vehicles.vehicle_models?.model || ''}`.trim();
            card.className = 'p-4 border border-gray-200 bg-gray-50 rounded-lg';
            card.innerHTML = `
                <div class="flex justify-between items-center">
                    <div>
                        <p class="font-bold text-gray-800">${report.vehicles.vehicle_no}</p>
                        <p class="text-sm text-gray-600">${brandAndModel}</p>
                    </div>
                    <p class="text-sm text-gray-500 font-semibold">Sent to Inspector</p>
                </div>
            `;
            pendingList.appendChild(card);
        });
    } else {
        noPendingMsg.classList.remove('hidden');
    }
}


// Add this new function anywhere in your <script> tag
async function resendForInspection(reportId) {
    const { error } = await sb.from('reports')
        .update({ status: 'pending_inspection' })
        .eq('id', reportId);

    if (error) {
        return showError('Failed to resend for inspection.');
    }

    showSuccessMessage('Job has been resent to the inspector.');
    populateInspectionPendingJobs(); // Refresh the list
}



// New functions for the inspector workflow
// REPLACE this function
async function populateInspectionQueue() {
    const listContainer = document.getElementById('inspection-queue-list');
    const noJobsMsg = document.getElementById('no-inspection-jobs-message');
    listContainer.innerHTML = '';
    noJobsMsg.classList.add('hidden');

    // THE FIX: Added 'inspection_remarks' to the query
    const query = sb.from('reports')
        .select(`id, complaint, suggested, inspection_remarks, vehicles!inner(vehicle_no, vehicle_name), executive:executive_id(username)`)
        .eq('status', 'pending_inspection')
        .order('created_at', { ascending: true });
    
    const reports = await handleSupabaseQuery(query, 'Could not fetch inspection queue.');
    if (reports === null || reports.length === 0) {
        noJobsMsg.classList.remove('hidden');
        return;
    }

    reports.forEach(report => {
        const card = document.createElement('div');
        card.className = 'p-4 border border-gray-200 rounded-lg flex justify-between items-center';

        // THE FIX: Check for remarks and create the badge if they exist
        const isReinspection = report.inspection_remarks && report.inspection_remarks.trim() !== '';
        const reinspectionBadge = isReinspection 
            ? '<span class="ml-2 text-xs font-semibold text-orange-800 bg-orange-200 px-2 py-0.5 rounded-full">Re-inspection</span>' 
            : '';

        const infoDiv = document.createElement('div');
        infoDiv.innerHTML = `
            <div class="flex items-center">
                <p class="font-bold text-gray-800">${report.vehicles.vehicle_no}</p>
                ${reinspectionBadge}
            </div>
            <p class="text-sm text-gray-600">${report.vehicles.vehicle_name || ''}</p>
            <p class="text-xs text-gray-500 mt-1">From: ${report.executive?.username || 'N/A'}</p>
        `;

        const viewButton = document.createElement('button');
        viewButton.className = 'btn-primary !w-auto !py-2 !px-4 flex-shrink-0';
        viewButton.textContent = 'View Details';
        viewButton.onclick = () => showInspectionDetails(report);

        card.appendChild(infoDiv);
        card.appendChild(viewButton);
        listContainer.appendChild(card);
    });
}

// REPLACE this function
function handleInspection(reportId, outcome, vehicleNo) {
    const modalTitle = document.getElementById('remarks-modal-title');
    const modalText = document.getElementById('remarks-modal-text');
    const confirmBtn = document.getElementById('confirm-inspection-button');
    const remarksInput = document.getElementById('inspection-remarks-input');
    const remarksLabel = document.querySelector('label[for="inspection-remarks-input"]');
    remarksInput.value = '';

    if (outcome === 'inspection_approved') {
        modalTitle.textContent = 'Approve Inspection';
        modalText.textContent = `Confirm approval for vehicle ${vehicleNo}.`;
        remarksLabel.innerHTML = 'Remarks (Optional):'; // CHANGED TEXT
        confirmBtn.className = 'px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold';
    } else {
        modalTitle.textContent = 'Reject Inspection';
        modalText.textContent = `Confirm rejection for vehicle ${vehicleNo}.`;
        remarksLabel.innerHTML = 'Remarks (Required for Rejection):'; // CHANGED TEXT
        confirmBtn.className = 'px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold';
    }

    confirmBtn.onclick = () => confirmInspection(reportId, outcome);
    // Hide the details modal before showing the remarks modal
    hideModal('inspector-details-modal'); 
    showModal('inspection-remarks-modal');
}


// Replace your existing confirmInspection function with this one
// REPLACE this function
async function confirmInspection(reportId, outcome) {
    if (!currentUser) return showError('Session expired. Please log in.');
    
    let remarks = document.getElementById('inspection-remarks-input').value.trim();
    
    if (outcome === 'rejected' && !remarks) {
        return showError('Remarks are required when rejecting a job.');
    }
    
    const finalStatus = outcome === 'inspection_approved' ? 'inspection_approved' : 'rejected';

    // THE FIX: If approved, clear out any old rejection remarks for data cleanliness
    if (outcome === 'inspection_approved') {
        remarks = ''; // Clear remarks on approval
    }

    const updateData = {
        status: finalStatus,
        inspector_id: currentUser.id,
        inspection_remarks: remarks,
        inspection_date: new Date().toISOString()
    };
    
    const { error } = await sb.from('reports').update(updateData).eq('id', reportId);
    
    hideModal('inspection-remarks-modal');
    if (error) return showError(`Failed to update status: ${error.message}`);

    showSuccessMessage('Inspection status updated successfully.');
    populateInspectionQueue();
}



// REPLACE this function
// REPLACE this function
async function populateWashPendingJobs() {
    if (!currentUser) return;
    const listContainer = document.getElementById('wash-pending-list');
    const noJobsMsg = document.getElementById('no-wash-pending-message');
    
    if (!listContainer || !noJobsMsg) return console.error("Wash pending elements not found.");

    listContainer.innerHTML = '';
    noJobsMsg.classList.add('hidden');

    const { data: reports, error } = await sb.from('reports')
        .select(`id, status, vehicles!inner(vehicle_no, vehicle_models(brand, model))`)
        .eq('executive_id', currentUser.id)
        .in('status', ['inspection_approved', 'Sent To Wash']);

    if (error) return showError('Could not fetch jobs for wash.');

    if (!reports || reports.length === 0) {
        noJobsMsg.classList.remove('hidden');
        return;
    }

    reports.forEach(report => {
        const card = document.createElement('div');
        // THE FIX: Added optional chaining (?.)
        const brandAndModel = `${report.vehicles.vehicle_models?.brand || ''} ${report.vehicles.vehicle_models?.model || ''}`.trim();
        
        if (report.status === 'inspection_approved') {
            card.className = 'p-4 border border-yellow-300 bg-yellow-50 rounded-lg flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3';
            card.innerHTML = `
                <div class="w-full text-left">
                    <p class="font-bold text-gray-800">${report.vehicles.vehicle_no}</p>
                    <p class="text-sm text-gray-600">${brandAndModel}</p>
                </div>
                <div class="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto flex-shrink-0">
                    <button onclick="updateJobStatus(${report.id}, 'Sent To Wash', '${report.vehicles.vehicle_no}')" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-3 rounded text-sm w-full sm:w-auto">
                        Send for Wash
                    </button>
                    <button onclick="markCompletedDirectly(${report.id}, '${report.vehicles.vehicle_no}')" class="bg-gray-600 hover:bg-gray-700 text-white font-bold py-1.5 px-3 rounded text-sm w-full sm:w-auto">
                        Skip & Complete
                    </button>
                </div>
            `;
        } else {
            card.className = 'p-4 border border-blue-300 bg-blue-50 rounded-lg flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3';
            card.innerHTML = `
                <div class="w-full text-left">
                    <p class="font-bold text-gray-800">${report.vehicles.vehicle_no}</p>
                    <p class="text-sm text-gray-600">${brandAndModel}</p>
                </div>
                <div class="w-full sm:w-auto text-left sm:text-right">
                     <p class="text-sm font-semibold text-blue-700">Currently in Wash</p>
                </div>
            `;
        }
        listContainer.appendChild(card);
    });
}
		
		
        
// REPLACE this function
async function populateCompletedWashJobs() {
    if (!currentUser) return;
    
    const listContainer = document.getElementById('complete-list');
    const noJobsMsg = document.getElementById('no-complete-message');
    
    if(!listContainer || !noJobsMsg) return console.error("Complete tab elements not found");

    listContainer.innerHTML = '';
    noJobsMsg.classList.add('hidden');
    
    const { data: reports, error } = await sb.from('reports')
        .select(`id, vehicles!inner(vehicle_no, vehicle_models(brand, model))`)
        .eq('executive_id', currentUser.id)
        .eq('status', 'Wash Completed')
        .order('created_at', { ascending: true });

    if (error) return showError('Could not fetch completed wash jobs.');

    if (!reports || reports.length === 0) {
        noJobsMsg.classList.remove('hidden');
        return;
    }

    reports.forEach(report => {
        const card = document.createElement('div');
        // THE FIX: Added optional chaining (?.)
        const brandAndModel = `${report.vehicles.vehicle_models?.brand || ''} ${report.vehicles.vehicle_models?.model || ''}`.trim();
        
        card.className = 'p-4 border border-green-300 bg-green-50 rounded-lg flex justify-between items-center';
        card.innerHTML = `
            <div>
                <p class="font-bold text-gray-800">${report.vehicles.vehicle_no}</p>
                <p class="text-sm text-gray-600">${brandAndModel}</p>
                <p class="text-sm text-green-700 font-semibold mt-1">Ready for delivery</p>
            </div>
            <button onclick="updateJobStatus(${report.id}, 'Completed', '${report.vehicles.vehicle_no}')" class="btn-primary !bg-green-600 hover:!bg-green-700 !w-auto !py-1.5 !px-3 text-sm">
                <span class="material-symbols-outlined !text-base">check_circle</span> Mark Completed
            </button>
        `;
        listContainer.appendChild(card);
    });
}

        // ADD NEW FUNCTION: Executive sends a job to the washer
        async function sendToWash(reportId) {
            const { error } = await sb.from('reports').update({ status: 'Sent To Wash' }).eq('id', reportId);
            if (error) return showError('Failed to send to wash.');
            showSuccessMessage('Vehicle sent to wash queue.');
            populateWashPendingJobs();
        }

        // ADD NEW FUNCTION: Executive completes job without washing
        function markCompletedDirectly(id, vehicleNo) {
            // Reuse the existing completion modal but change its text
            document.getElementById('complete-modal-text').textContent = `Are you sure you want to close the job for vehicle ${vehicleNo} WITHOUT sending it for wash?`;
            document.getElementById('confirm-complete-button').onclick = () => handleCompletionConfirmation(id, vehicleNo);
            showModal('complete-confirmation-modal');
        }
		
		
function normalizeName(str) {
    if (!str) return '';
    // Replace hyphens/multiple spaces with a single space, then convert to Title Case
    return str.trim()
              .replace(/[\s-]+/g, ' ')
              .toLowerCase()
              .split(' ')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
}
        
async function addVehicleModel() {
    // Use your robust normalizeName function to standardize the input
    const brand = normalizeName(document.getElementById('new-brand-admin').value);
    const model = normalizeName(document.getElementById('new-model-admin').value);
    if (!brand || !model) {
        return showError('Brand and model are required.');
    }
    // Check for duplicates before inserting
    const { data: existing, error: checkError } = await sb
        .from('vehicle_models')
        .select('id')
        .eq('brand', brand)
        .eq('model', model)
        .maybeSingle();
    if (checkError) {
        return showError(`Error checking for duplicates: ${checkError.message}`);
    }
    if (existing) {
        return showError(`'${brand} - ${model}' already exists in the database.`);
    }
    // Only insert if no duplicate was found
    const { error } = await sb.from('vehicle_models').insert({ brand, model });
    if (error) {
        return showError(`Could not add model: ${error.message}`);
    }
    document.getElementById('add-vehicle-model-form').reset();
    showSuccessMessage("Vehicle model added successfully.");
    renderVehicleModelList();
}

        // --- ADMIN: USER MANAGEMENT ---
async function renderUserList(role) {
    // MODIFIED THIS LINE TO INCLUDE THE NEW INSPECTOR LIST ID
    const listId = role === 'admin' ? 'admins-list' : (role === 'executive' ? 'executives-list' : (role === 'washer' ? 'washers-list' : 'inspectors-list'));
    const list = document.getElementById(listId);
    list.innerHTML = '';

    const { data, error } = await sb.from('users').select('id, username, team').eq('role', role);
    if (error) return showError(`Could not fetch ${role}s.`);

    data.forEach(user => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between bg-gray-50 p-3 rounded-lg';

        let userDisplayHtml;

        if (role === 'executive' && user.team) {
            userDisplayHtml = `
                <div class="flex-grow flex justify-between items-center mr-4">
                    <p class="font-semibold">${user.username}</p>
                    <span class="text-xs font-medium text-gray-700 bg-gray-200 px-2 py-1 rounded-full">${user.team}</span>
                </div>`;
        } else {
            userDisplayHtml = `<p class="font-semibold flex-grow mr-4">${user.username}</p>`;
        }

        div.innerHTML = `
            ${userDisplayHtml}
            <button onclick="confirmDeletion('user', ${user.id}, '${role}')" class="text-red-500 hover:text-red-700 shrink-0">
                <span class="material-symbols-outlined">delete</span>
            </button>
        `;

        list.appendChild(div);
    });
}

async function addUser(role) {
    const usernameInputId = `new-${role}-username`;
    const passwordInputId = `new-${role}-pass`;
    const formId = `add-${role}-form`;

    const username = document.getElementById(usernameInputId).value.trim();
    const password = document.getElementById(passwordInputId).value.trim();

    if (!username || !password) return showError('Username and password are required.');

    const userData = { username, password, role };
    
    if (role === 'executive') {
        const team = document.getElementById('new-exec-team').value;
        if (!team) return showError('Please select a team for the executive.');
        userData.team = team;
    }

    const { error } = await sb.from('users').insert(userData);
    if (error) return showError(`Could not create ${role}: ${error.message}`);
    
    showSuccessMessage(`${role.charAt(0).toUpperCase() + role.slice(1)} created.`);
    document.getElementById(formId).reset();
    renderUserList(role);
}

        // --- ADMIN & EXECUTIVE: REPORTS ---

//
// THIS IS THE FINAL, MORE ROBUST FUNCTION. PLEASE REPLACE THE OLD ONE WITH THIS.
//
async function fetchAndPopulateReports(isAdmin = false) {
    const tableContainerId = isAdmin ? 'admin-reports-screen' : 'report-screen';
    const tableBodyId = isAdmin ? 'admin-report-table-body' : 'report-table-body';
    const tableEl = document.querySelector(`#${tableContainerId} .report-table`);
    const tableBody = document.getElementById(tableBodyId);
    const noReportsMsg = document.getElementById(isAdmin ? 'admin-no-reports-message' : 'no-reports-message');
    // --- Define all possible columns and their render logic ---
    const allColumns = [
        { key: 'vehicle_no', label: 'Vehicle No.', render: (row) => `<button onclick='printJobCardById(${row.id})' class="text-gray-500 hover:text-green-600 p-1 rounded-full shrink-0"><span class="material-symbols-outlined">download</span></button><span>${row.vehicles.vehicle_no}</span>`, className: 'flex items-center gap-x-2' },
        { key: 'vehicle_name', label: 'Vehicle Name', render: (row) => row.vehicles.vehicle_name || 'N/A' },
        { key: 'model', label: 'Model', render: (row) => row.vehicles.vehicle_models.model },
        { key: 'brand', label: 'Brand', render: (row) => row.vehicles.vehicle_models.brand },
        { key: 'color', label: 'Color', render: (row) => row.vehicles.color || 'N/A' },
        { key: 'engine_no', label: 'Engine No', render: (row) => row.vehicles.engine_no || 'N/A' },
        { key: 'chassis_no', label: 'Chassis No', render: (row) => row.vehicles.chassis_no || 'N/A' },
        { key: 'client_name', label: 'Client Name', render: (row) => row.client_name || 'N/A' },
        { key: 'client_phone', label: 'Client Phone', render: (row) => row.client_phone || 'N/A' },
        { key: 'odometer', label: 'Odometer', render: (row) => row.odometer_reading || 'N/A' },
        { key: 'executive', label: 'Executive', render: (row) => row.executive ? row.executive.username : 'N/A' },
        { key: 'inspector', label: 'Inspector', render: (row) => row.inspector ? row.inspector.username : 'N/A' },
        { key: 'date_time', label: 'Date & Time', render: (row) => new Date(row.created_at).toLocaleString('en-GB') },
        { key: 'status', label: 'Status', render: (row) => { const colors = { 'Completed': 'bg-green-100 text-green-800', 'Ongoing': 'bg-orange-100 text-orange-800', 'Not Started': 'bg-red-100 text-red-800', 'Cancelled': 'bg-gray-200 text-gray-800', 'Sent To Wash': 'bg-blue-100 text-blue-800', 'Wash Completed': 'bg-purple-100 text-purple-800' }; return `<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${colors[row.status] || 'bg-gray-100 text-gray-800'}">${row.status}</span>`; } },
        { key: 'complaint', label: 'Complaint', render: (row) => formatArrayCell(row.complaint), className: 'whitespace-normal max-w-xs truncate' },
        { key: 'suggested', label: 'Suggested', render: (row) => formatArrayCell(row.suggested), className: 'whitespace-normal max-w-xs truncate' },
        { key: 'approved', label: 'Approved', render: (row) => formatArrayCell(row.approved), className: 'whitespace-normal max-w-xs truncate' },
        { key: 'feedback_text', label: 'Feedback Text', render: (row) => row.customer_feedback_text || 'N/A', className: 'whitespace-normal max-w-xs truncate' },
        { key: 'feedback_voice', label: 'Feedback Voice', render: (row) => row.customer_feedback_audio ? `<audio controls src="${row.customer_feedback_audio}" class="w-48 h-8"></audio>` : 'N/A' },
        { key: 'marks', label: 'Marks', render: (row) => (row.marks && row.marks.length > 2) ? `<button onclick='openMarksModal(${JSON.stringify(row.marks)})' class="px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 text-xs">View</button>` : 'N/A' },
        { key: 'media', label: 'Media', render: (row) => row.gdrive_folder_url ? `<a href="${row.gdrive_folder_url}" target="_blank" class="px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 text-xs font-semibold">View Files</a>` : '<span class="text-xs text-gray-500">Not Uploaded</span>' }
    ];
    const visibleColumnKeys = appSettings.visible_report_columns || allColumns.map(c => c.key);
    const columnsToRender = allColumns.filter(c => visibleColumnKeys.includes(c.key));
    // --- Dynamically build the table header ---
    let thead = tableEl.querySelector('thead');
    if (!thead) {
        thead = document.createElement('thead');
        tableEl.prepend(thead);
    }
    thead.innerHTML = `<tr>${columnsToRender.map(col => `<th>${col.label}</th>`).join('')}</tr>`;
    // --- Get Filter Values ---
    const fromDate = document.getElementById(isAdmin ? 'admin-filter-from-date' : 'filter-from-date').value;
    const toDate = document.getElementById(isAdmin ? 'admin-filter-to-date' : 'filter-to-date').value;
    const vehicleNo = document.getElementById(isAdmin ? 'admin-filter-vehicle-no' : 'filter-vehicle-no').value.trim().toUpperCase();
    const brand = document.getElementById(isAdmin ? 'admin-filter-brand' : 'filter-brand').value.trim();
    const execName = isAdmin ? document.getElementById('admin-filter-exec-name').value.trim() : '';
    // --- NEW: More Robust Executive Filter Logic ---
    let executiveIdsToFilter = [];
    if (isAdmin && execName) {
        // Step 1: Find the IDs of executives matching the name.
        const { data: users, error: userError } = await sb
            .from('users')
            .select('id')
            .ilike('username', `%${execName}%`);
        if (userError) {
            showError("Could not search for executives.", userError);
            return;
        }
        if (users.length === 0) {
            // If no executives match the name, show an empty table immediately.
            tableBody.innerHTML = '';
            noReportsMsg.classList.remove('hidden');
            return;
        }
        executiveIdsToFilter = users.map(user => user.id);
    }
    // --- End of New Logic ---
    // --- Build The Query ---
    let query = sb.from('reports').select(`
        id, created_at, status, complaint, suggested, approved, marks,
        odometer_reading, client_name, client_phone,
        gdrive_folder_url, customer_feedback_text, customer_feedback_audio,
        vehicles!inner(
          id, vehicle_no, vehicle_name, color, engine_no, chassis_no,
          vehicle_models!inner(brand, model)
        ),
        executive:executive_id(username, id),
        inspector:inspector_id(username, id)
    `).order('created_at', { ascending: false });
    // --- Apply Filters To The Query ---
    if (isAdmin) {
        // Step 2: Use the IDs we found to filter the main reports query.
        if (executiveIdsToFilter.length > 0) {
            query = query.in('executive_id', executiveIdsToFilter);
        }
    } else {
        // For executives, STRICTLY filter by their own ID.
        query = query.eq('executive_id', currentUser.id);
    }
    if (fromDate) {
        query = query.gte('created_at', `${fromDate}T00:00:00`);
    }
    if (toDate) {
        query = query.lte('created_at', `${toDate}T23:59:59`);
    }
    if (vehicleNo) {
        query = query.ilike('vehicles.vehicle_no', `%${vehicleNo}%`);
    }
    if (brand) {
        query = query.ilike('vehicles.vehicle_models.brand', `%${brand}%`);
    }
    const reports = await handleSupabaseQuery(query, "Failed to fetch reports.");
    if (reports === null) return;
    reportsDataStore = {};
    reports.forEach(row => { reportsDataStore[row.id] = row; });
    // --- Dynamically build the table body ---
    tableBody.innerHTML = '';
    if (reports.length === 0) {
        noReportsMsg.classList.remove('hidden');
        return;
    }
    noReportsMsg.classList.add('hidden');
    reports.forEach(row => {
        const tr = document.createElement('tr');
        columnsToRender.forEach(col => {
            const td = document.createElement('td');
            if (col.className) td.className = col.className;
            if (col.key === 'complaint' || col.key === 'suggested' || col.key === 'approved' || col.key === 'feedback_text') {
                td.title = formatArrayCell(row[col.key]);
            }
            td.innerHTML = col.render(row);
            tr.appendChild(td);
        });
        tableBody.appendChild(tr);
    });
}
		
        
        function applyAdminReportFilters() { fetchAndPopulateReports(true); }
       function clearAdminReportFilters() { 
            document.getElementById('admin-report-filters').querySelectorAll('input, select').forEach(input => input.value = ''); 
            document.getElementById('admin-filter-to-date').min = '';
            document.getElementById('admin-filter-from-date').max = '';
            fetchAndPopulateReports(true); 
        }
        function applyReportFilters() { fetchAndPopulateReports(false); }
        function clearReportFilters() { 
            document.getElementById('report-filters').querySelectorAll('input, select').forEach(input => input.value = ''); 
            document.getElementById('filter-to-date').min = '';
            document.getElementById('filter-from-date').max = '';
            fetchAndPopulateReports(false); 
        }


        async function renderAnalytics() {
            const month = document.getElementById('analytics-month-filter').value;
            const executiveId = document.getElementById('analytics-exec-filter').value;
            const executiveName = document.getElementById('analytics-exec-filter').selectedOptions[0].text;

            let query = sb.from('reports').select('status');
            if(month) query = query.like('created_at', `${month}%`);
            if(executiveId) query = query.eq('executive_id', executiveId);

            const { data, error } = await query;
            if(error) return showError('Failed to get analytics data.');
            
            const completed = data.filter(r => r.status === 'Completed').length;
            const pending = data.length - completed;
            const total = data.length;
            const completedPercent = total > 0 ? (completed / total * 100).toFixed(1) : 0;
            const pendingPercent = total > 0 ? (pending / total * 100).toFixed(1) : 0;

            const chartDiv = document.getElementById('analytics-chart');
            chartDiv.innerHTML = `
                <div><div class="flex justify-between text-sm mb-1"><span class="font-medium text-green-600">Completed (${completed})</span><span>${completedPercent}%</span></div><div class="w-full bg-gray-200 rounded-full h-3"><div class="bg-green-500 h-3 rounded-full" style="width: ${completedPercent}%"></div></div></div>
                <div><div class="flex justify-between text-sm mb-1"><span class="font-medium text-orange-600">Pending/Ongoing (${pending})</span><span>${pendingPercent}%</span></div><div class="w-full bg-gray-200 rounded-full h-3"><div class="bg-orange-500 h-3 rounded-full" style="width: ${pendingPercent}%"></div></div></div>`;
            document.getElementById('analytics-title').textContent = `${executiveId ? executiveName : 'Overall'} Status for ${month ? new Date(month + '-02').toLocaleString('default', { month: 'long', year: 'numeric' }) : 'All Time'}`;
        }

        async function populateAnalyticsFilters() {
            const { data: execs, error: execsError } = await sb.from('users').select('id, username').eq('role', 'executive');
            if(execsError) return showError('Could not load executives.');
            const execFilter = document.getElementById('analytics-exec-filter');
            execFilter.innerHTML = '<option value="">All Executives</option>';
            execs.forEach(e => {
                const opt = document.createElement('option');
                opt.value = e.id;
                opt.textContent = e.username;
                execFilter.appendChild(opt);
            });

            const { data: reports, error: reportsError } = await sb.from('reports').select('created_at');
            if(reportsError) return showError('Could not load report dates.');
            const monthFilter = document.getElementById('analytics-month-filter');
            const months = [...new Set(reports.map(r => r.created_at.substring(0, 7)))];
            monthFilter.innerHTML = '<option value="">All Months</option>';
            months.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = new Date(m + '-02').toLocaleString('default', { month: 'long', year: 'numeric' });
                monthFilter.appendChild(opt);
            });
        }
        
        // --- EXECUTIVE: JOB CARD ---
// REPLACE this entire function
async function searchVehicle() {
    const rawVehicleNumber = document.getElementById('search-vehicle-number').value;
    const vehicleNumber = normalizeVehicleNumber(rawVehicleNumber);
    hideAllSections();
    if (!vehicleNumber) {
        showError('Please enter a vehicle number.');
        return;
    }
    const { data, error } = await sb
        .from('vehicles')
        .select(`
            id, vehicle_no, fuel_type, odometer, client_name, client_phone, vehicle_name, color, engine_no, chassis_no,
            vehicle_models ( brand, model )
        `)
        .eq('vehicle_no', vehicleNumber)
        .single();

    const odometerWrapper = document.getElementById('odometer-display-wrapper');
    const clientNameWrapper = document.getElementById('client-name-wrapper');
    const clientPhoneWrapper = document.getElementById('client-phone-wrapper');

    if (data) { // Vehicle Found
        const { data: latestReportData, error: latestReportError } = await sb
            .from('reports')
            .select('odometer_reading')
            .eq('vehicle_id', data.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (latestReportError) {
            console.error("Error fetching latest odometer:", latestReportError);
        }

        const latestOdometer = latestReportData?.odometer_reading || data.odometer;
        currentVehicleId = data.id;
        currentOdometer = latestOdometer;
        originalClientName = data.client_name;
        originalClientPhone = data.client_phone;

        document.getElementById('detail-vehicle-number').textContent = data.vehicle_no;
        
        // --- START OF FIX ---
        // Safely access brand and model using optional chaining (?.)
        // This prevents the "Cannot read properties of null" error.
        document.getElementById('detail-brand').textContent = data.vehicle_models?.brand || 'N/A';
        document.getElementById('detail-model').textContent = data.vehicle_models?.model || 'N/A';
        // --- END OF FIX ---

        document.getElementById('detail-fuel-type').textContent = data.fuel_type || 'N/A';
        document.getElementById('detail-vehicle-name').textContent = data.vehicle_name || 'N/A';
        document.getElementById('detail-color').textContent = data.color || 'N/A';
        document.getElementById('detail-engine-no').textContent = data.engine_no || 'N/A';
        document.getElementById('detail-chassis-no').textContent = data.chassis_no || 'N/A';

        clientNameWrapper.innerHTML = `<input type="text" id="detail-client-name-input" class="form-input" value="${data.client_name || ''}">`;
        clientPhoneWrapper.innerHTML = `<input type="tel" id="detail-client-phone-input" class="form-input" value="${data.client_phone || ''}" maxlength="10" oninput="this.value = this.value.replace(/[^0-9]/g, '');">`;
        odometerWrapper.innerHTML = `<input type="number" id="detail-odometer-input" class="form-input" value="${latestOdometer || 0}">`;
        
        document.getElementById('detail-odometer-input').addEventListener('blur', checkOdometer);
        vehicleDetailsSection.classList.remove('hidden');
        newComplaintSection.classList.remove('hidden');
        setTimeout(resizeCanvas, 50);

    } else { // Vehicle Not Found
        currentVehicleId = null;
        currentOdometer = 0;
        clientNameWrapper.innerHTML = `<p id="detail-client-name" class="font-semibold"></p>`;
        clientPhoneWrapper.innerHTML = `<p id="detail-client-phone" class="font-semibold"></p>`;
        odometerWrapper.innerHTML = `<p id="detail-odometer" class="font-semibold"></p>`;
        document.getElementById('new-vehicle-number').value = vehicleNumber;
        populateExecutiveVehicleDropdowns();
        createVehicleSection.classList.remove('hidden');
    }
}


        async function populateExecutiveVehicleDropdowns() {
            if (vehicleModelsCache.length === 0) { 
                const { data, error } = await sb.from('vehicle_models').select('*');
                if (error) return showError('Could not fetch vehicle models.');
                vehicleModelsCache = data;
            }
            
            const brandSelect = document.getElementById('new-vehicle-brand-exec');
            brandSelect.innerHTML = '<option value="">Select Brand</option>';
            
            const uniqueBrands = [...new Set(vehicleModelsCache.map(item => item.brand))];
            uniqueBrands.forEach(brand => {
                const opt = document.createElement('option');
                opt.value = brand;
                opt.textContent = brand;
                brandSelect.appendChild(opt);
            });
            populateModelDropdown();
        }

        function populateModelDropdown() {
            const brand = document.getElementById('new-vehicle-brand-exec').value;
            const modelSelect = document.getElementById('new-vehicle-model-exec');
            modelSelect.innerHTML = '<option value="">Select Model</option>';

            const modelsForBrand = vehicleModelsCache.filter(item => item.brand === brand);
            modelsForBrand.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.id; 
                opt.textContent = item.model;
                modelSelect.appendChild(opt);
            });
        }

	    function checkOdometer() {
    const newOdometerInput = document.getElementById('detail-odometer-input');
    const warningSpan = document.getElementById('odometer-warning');
    const newOdometerValue = parseInt(newOdometerInput.value);
    if (newOdometerValue < currentOdometer) {
        warningSpan.textContent = 'Reading is lower than last service!';
        warningSpan.classList.remove('hidden');
        newOdometerInput.classList.add('border-red-500', 'focus:border-red-500', 'focus:ring-red-500');
        // This is the new part: Hide the warning after 4 seconds
        setTimeout(() => {
            warningSpan.classList.add('hidden');
            newOdometerInput.classList.remove('border-red-500', 'focus:border-red-500', 'focus:ring-red-500');
        }, 4000); // 4000 milliseconds = 4 seconds
    } else {
        warningSpan.textContent = '';
        warningSpan.classList.add('hidden');
        newOdometerInput.classList.remove('border-red-500', 'focus:border-red-500', 'focus:ring-red-500');
    }
}
        
// REPLACE this function
async function createVehicle() {
    const showFullForm = appSettings.show_full_vehicle_form === true;

    // THE FIX: Client Name is now collected regardless of the form mode
    const newVehicle = {
        vehicle_no: normalizeVehicleNumber(document.getElementById('new-vehicle-number').value),
        client_phone: document.getElementById('new-client-phone').value.trim(),
        client_name: document.getElementById('new-client-name').value.trim()
    };

    // Validation for essential customer info
    if (!newVehicle.client_name) return showError('Client Name is required.');
    if (!/^\d{10}$/.test(newVehicle.client_phone)) {
        return showError('Please enter a valid 10-digit phone number.');
    }

    if (showFullForm) {
        Object.assign(newVehicle, {
            model_id: document.getElementById('new-vehicle-model-exec').value,
            fuel_type: document.getElementById('new-fuel-type').value,
            odometer: document.getElementById('new-odometer').value,
            vehicle_name: document.getElementById('new-vehicle-name').value.trim(),
            color: document.getElementById('new-color').value.trim(),
            engine_no: document.getElementById('new-engine-no').value.trim(),
            chassis_no: document.getElementById('new-chassis-no').value.trim(),
        });
        if (!newVehicle.model_id || !newVehicle.fuel_type || !newVehicle.odometer || !newVehicle.engine_no || !newVehicle.chassis_no) {
            return showError('Please fill all mandatory vehicle details.');
        }
    } else {
        newVehicle.odometer = 0;
    }

    const { data, error } = await sb.from('vehicles').insert(newVehicle).select().single();
    if (error) {
        return showError(`Failed to create vehicle: ${error.message}`, error);
    }
    
    currentVehicleId = data.id;
    document.getElementById('create-vehicle-form').reset();
    createVehicleSection.classList.add('hidden');
    showSuccessMessage('Vehicle created successfully!');
    searchVehicle();
}

        // This version adds a complaint with a default amount of 0.
function addComplaint() {
    const complaintInput = document.getElementById('complaint-input');
    const complaintText = complaintInput.value.trim();

    if (complaintText) {
        // Add complaint with a default amount of 0. This will be edited on the Update screen.
        currentComplaints.push({ text: complaintText, amount: 0, type: 'complaint' });
        complaintInput.value = '';
        renderComplaints();
    }
    complaintInput.focus();
}

        function deleteComplaint(index) {
            currentComplaints.splice(index, 1);
            renderComplaints();
        }

        // This version displays only the complaint text, not the amount.
// This version displays only the complaint text, not the amount.
function renderComplaints() {
    const list = document.getElementById('complaints-list');
    list.innerHTML = '';

    if (currentComplaints.length === 0) {
        list.innerHTML = '<p class="text-sm text-gray-500">No complaints added yet.</p>';
        return;
    }

    currentComplaints.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between bg-gray-50 p-3 rounded-lg text-sm';
        // Display only the text, not the amount, on the Job Card screen.
        div.innerHTML = `
            <p class="flex-1 mr-2 break-all">${item.text}</p>
            <button onclick="deleteComplaint(${index})" class="text-red-500 hover:text-red-700 shrink-0">
                <span class="material-symbols-outlined">delete</span>
            </button>
        `;
        list.appendChild(div);
    });
}
        
        async function handleDuplicateConfirmation() {
            const confirmationInput = document.getElementById('duplicate-confirmation-input');
            if (confirmationInput.value.trim().toLowerCase() === 'yes') {
                hideModal('duplicate-job-card-modal');
                confirmationInput.value = ''; // Clear the input
                await executeSaveComplaints(); // Proceed with saving
            } else {
                showError("Confirmation text did not match. Please type 'yes' to proceed.");
            }
        }

async function saveComplaints() {
            // ADDED: Guard clause to prevent crash if session is lost
            if (!currentUser) {
                console.error("saveComplaints: currentUser is null. Aborting.");
                return showError("Session expired. Please log in again.");
            }

            addComplaint(); 
            
            if (currentComplaints.length === 0) return showError('Please add at least one complaint.');
            if (!currentVehicleId) return showError('No vehicle selected.');

            const today = new Date();
            today.setHours(0, 0, 0, 0); 
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const { data: teamUsers, error: teamError } = await sb
                .from('users')
                .select('id')
                .eq('team', currentUser.team);
            
            if (teamError) return showError('Could not verify team data.');
            const teamUserIds = teamUsers.map(u => u.id);

			const { data: existingReport, error: checkError } = await sb
				.from('reports')
				// CORRECTED LINE: Specify the executive relationship
				.select('id, users!reports_executive_id_fkey ( username )')
				.eq('vehicle_id', currentVehicleId)
				.gte('created_at', today.toISOString())
				.lt('created_at', tomorrow.toISOString())
				.in('executive_id', teamUserIds)
				.maybeSingle();

            if (checkError) {
                console.error("Error checking for existing report:", checkError);
                return showError('Could not check for existing job cards. Please try again.');
            }

            if (existingReport) {
                const executiveName = existingReport.users ? existingReport.users.username : 'another executive';
                document.getElementById('duplicate-modal-text').textContent = `A job card for this vehicle was already created today by ${executiveName} from your team. Are you sure you want to create another one?`;
                showModal('duplicate-job-card-modal');
                return; 
            }
            
            await executeSaveComplaints();
        }

        async function executeSaveComplaints() {
            const hasMedia = capturedPhotos.length > 0 || voiceNoteBlob;

            if (hasMedia && !gapi.client.getToken()) {
                showError('Google Drive access required for media. Please authorize.');
                tokenClient.callback = async (resp) => {
                    if (resp.error !== undefined) {
                        showError('Authorization failed. Please try again.');
                        throw (resp);
                    }
                    updateAuthUI(true);
                    showSuccessMessage('Google Drive authorized. Now saving...');
                    await executeSaveComplaints(); // Retry saving after auth
                };
                tokenClient.requestAccessToken({prompt: 'consent'});
                return;
            }
            
            const newOdometerInput = document.getElementById('detail-odometer-input');
            const serviceOdometer = newOdometerInput.value;

            const serviceClientName = document.getElementById('detail-client-name-input').value.trim();
            const serviceClientPhone = document.getElementById('detail-client-phone-input').value.trim();
            
            if (!/^\d{10}$/.test(serviceClientPhone)) {
                return showError('Please enter a valid 10-digit phone number for the client.');
            }
            if (!serviceClientName) {
                return showError('Client name cannot be empty.');
            }
            
            showSuccessMessage('Saving report...');

            const { data: reportData, error: reportError } = await sb.from('reports').insert({
                vehicle_id: currentVehicleId,
                executive_id: currentUser.id,
                complaint: JSON.stringify(currentComplaints),
                status: 'Not Started',
                marks: JSON.stringify(damageMarks),
                odometer_reading: serviceOdometer,
                client_name: serviceClientName,
                client_phone: serviceClientPhone
            }).select('id').single();

            if(reportError) {
                console.error("Error saving report:", reportError);
                return showError(`Failed to save complaints: ${reportError.message}`);
            }

            const reportId = reportData.id;

            if (hasMedia) {
                const vehicleNo = document.getElementById('detail-vehicle-number').textContent || `Vehicle-${currentVehicleId}`;
                const jobFolderName = `${vehicleNo}_${reportId}`;

                try {
                    const folderId = await createDriveFolder(jobFolderName);
                    
                    const uploadPromises = [];
                    capturedPhotos.forEach((photo, index) => {
                        uploadPromises.push(uploadFileToDrive(folderId, photo, `photo_${index + 1}.jpg`));
                    });
                    if (voiceNoteBlob) {
                        uploadPromises.push(uploadFileToDrive(folderId, voiceNoteBlob, 'voice_note.webm'));
                    }

                    await Promise.all(uploadPromises);
                    
                    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
                    const { error: updateError } = await sb.from('reports').update({ gdrive_folder_url: folderUrl }).eq('id', reportId);
                    if (updateError) throw updateError;
                    
                    showSuccessMessage('Media uploaded successfully!');
                } catch (driveError) {
                    console.error('Google Drive or DB Update Error:', driveError);
                    showError('Report saved, but media upload failed. Check Google Drive authorization.');
                }
            }

            const updates = {};
            const newOdometer = parseInt(serviceOdometer);

            if (newOdometer > currentOdometer) updates.odometer = newOdometer;
            if (serviceClientName !== originalClientName) updates.client_name = serviceClientName;
            if (serviceClientPhone !== originalClientPhone) updates.client_phone = serviceClientPhone;

            if (Object.keys(updates).length > 0) {
                const { error: vehicleUpdateError } = await sb.from('vehicles').update(updates).eq('id', currentVehicleId);
                 if(vehicleUpdateError) {
                    console.error("Error updating vehicle details:", vehicleUpdateError);
                    showError('Report saved, but failed to update vehicle details.');
                }
            }
            
            showSuccessMessage('Job Card saved successfully!');
            resetJobCardState();
        }

        async function saveSuggestionsForApproval() {
            if (!currentReportId) {
                showError('No report selected.');
                return false; // Indicate failure
            }

            const allSuggestions = [...new Set(newSuggestions)];
            const updateData = { suggested: JSON.stringify(allSuggestions) };

            const { error } = await sb.from('reports').update(updateData).eq('id', currentReportId);
            if (error) {
                showError(`Failed to save suggestions: ${error.message}`);
                return false; // Indicate failure
            }
            
            console.log('Suggestions saved for approval link.');
            return true; // Indicate success
        }
        

// This function now contains the confirmation logic
function addSuggestion() {
    const suggestionInput = document.getElementById('suggestion-input');
    const suggestionText = suggestionInput.value.trim();
    if (!suggestionText) return; // Do nothing if the input is empty

    if (hasCustomerApproval) {
        showModal('change-confirmation-modal');
        const confirmBtn = document.getElementById('confirm-change-button');
        const cancelBtn = document.getElementById('cancel-change-button');

        confirmBtn.onclick = () => {
            hideModal('change-confirmation-modal');
            executeAddSuggestion(); // Proceed with adding if confirmed
        };
        // The cancel button's default onclick (from the HTML) is enough here
    } else {
        executeAddSuggestion(); // No approval yet, so add directly
    }
}

// This function contains the original core logic for adding a suggestion
function executeAddSuggestion() {
    const suggestionInput = document.getElementById('suggestion-input');
    const amountInput = document.getElementById('suggestion-amount-input');
    const suggestionText = suggestionInput.value.trim();
    const suggestionAmount = parseFloat(amountInput.value) || 0;

    if (suggestionText) {
        newSuggestions.push({ text: suggestionText, amount: suggestionAmount, type: 'suggestion' });
        suggestionInput.value = '';
        amountInput.value = '';
        
        const approvedItems = [];
        document.querySelectorAll('#customer-approval-list input[type="checkbox"]:checked').forEach(checkbox => {
            try {
                approvedItems.push(JSON.parse(checkbox.value));
            } catch {}
        });
        renderSuggestions(originalComplaintsForUpdate, newSuggestions, approvedItems);
    }
    suggestionInput.focus();
}


// REPLACE the existing deleteSuggestion function
function deleteSuggestion(index) {
    newSuggestions.splice(index, 1);
    const approvedItems = [];
    document.querySelectorAll('#customer-approval-list input[type="checkbox"]:checked').forEach(checkbox => {
        try {
            approvedItems.push(JSON.parse(checkbox.value));
        } catch {
            approvedItems.push(checkbox.value);
        }
    });
    renderSuggestions(originalComplaintsForUpdate, newSuggestions, approvedItems);
}
function updateCustomerTotal() {
    const totalAmountEl = document.getElementById('cust-total-amount');
    let total = 0;
    document.querySelectorAll('#approval-suggestions-list input[type="checkbox"]:checked').forEach(checkbox => {
        try {
            const item = JSON.parse(checkbox.value);
            total += item.amount || 0;
        } catch {}
    });
    if (totalAmountEl) {
        totalAmountEl.textContent = `₹ ${total.toFixed(2)}`;
    }
}
// ADD THIS NEW FUNCTION
// Updates the cost of a complaint in the state array when the executive types in the input field.
function updateComplaintCost(text, newAmount) {
    const complaint = originalComplaintsForUpdate.find(c => c.text === text);
    if (complaint) {
        complaint.amount = parseFloat(newAmount) || 0;
    }
    recalculateAndUpdateTotal();
}

// ADD THIS NEW FUNCTION
// Calculates the total cost from both original complaints and new suggestions and updates the UI.
function recalculateAndUpdateTotal() {
    const totalAmountEl = document.getElementById('approx-total-amount');
    let totalAmount = 0;
    // Find all checked checkboxes in the list and sum their values
    document.querySelectorAll('#customer-approval-list input[type="checkbox"]:checked').forEach(checkbox => {
        try {
            // The checkbox value is a stringified JSON object, so we parse it
            const item = JSON.parse(checkbox.value);
            if (item && typeof item.amount === 'number') {
                totalAmount += item.amount;
            }
        } catch (e) {
            console.error("Could not parse checkbox value for total calculation:", checkbox.value);
        }
    });
    totalAmountEl.textContent = `₹ ${totalAmount.toFixed(2)}`;
}

function renderSuggestions(complaints = [], suggestions = [], approved = []) {
    const executiveList = document.getElementById('executive-suggestions-list');
    const customerComplaintsList = document.getElementById('customer-complaints-list');
    const customerApprovalList = document.getElementById('customer-approval-list');

    // ADD THIS LINE: Check which tab is currently active.
    const isPendingTabActive = document.getElementById('tab-btn-pending').classList.contains('active-tab');

    // 1. Render editable customer complaints
    customerComplaintsList.innerHTML = '';
    if (complaints.length > 0) {
        complaints.forEach((item) => {
            const sanitizedText = item.text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const complaintItem = document.createElement('div');
            complaintItem.className = 'flex items-center justify-between gap-3 p-3 bg-gray-100 rounded-lg';
            complaintItem.innerHTML = `
                <div class="flex-1">
                    <span class="font-medium break-words">${item.text}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="font-bold text-gray-500">₹</span>
                    <input type="number" class="form-input !py-1 !px-2 w-20 text-right" 
                           value="${item.amount || 0}" placeholder="Cost"
                           data-text="${sanitizedText}" oninput="updateComplaintCost(this.dataset.text, this.value)">
                </div>
            `;
            customerComplaintsList.appendChild(complaintItem);
        });
    } else {
        customerComplaintsList.innerHTML = '<p class="text-sm text-gray-500">No original complaints were registered.</p>';
    }
    
    // 2. Render NEW mechanic suggestions
    executiveList.innerHTML = '';
    if (suggestions.length > 0) {
        suggestions.forEach((item, index) => {
            const execItem = document.createElement('div');
            execItem.className = 'flex items-center justify-between bg-gray-50 p-2 rounded-lg text-sm';
            execItem.innerHTML = `
                <p class="flex-1 mr-2">${item.text} - <span class="font-bold">₹${item.amount.toFixed(2)}</span></p>
                <button type="button" onclick="deleteSuggestion(${index})" class="text-red-500 hover:text-red-700 shrink-0">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            `;
            executiveList.appendChild(execItem);
        });
    }

    // 3. Render the COMBINED list for the final approval checklist
    customerApprovalList.innerHTML = '';
    const allItemsForApproval = [...complaints, ...suggestions]; 

    if (allItemsForApproval.length > 0) {
        const hasCustomerResponded = approved.length > 0;
        
        allItemsForApproval.forEach(item => {
            const isChecked = hasCustomerResponded
                ? approved.some(approvedItem => (approvedItem.text || approvedItem) === item.text)
                : true;

            const checkboxValue = `'${JSON.stringify(item)}'`;
            const sanitizedText = item.text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const materialsValue = item.materials || '';
            
            const isOriginalComplaint = item.type === 'complaint';
            const bgColor = isOriginalComplaint ? 'bg-gray-100' : 'bg-blue-50';
            const tag = isOriginalComplaint 
                ? `<span class="text-xs text-gray-500">(Customer Request)</span>` 
                : `<span class="text-xs text-blue-600">(New Suggestion)</span>`;

            const approvalItemContainer = document.createElement('div');
            approvalItemContainer.className = `p-3 ${bgColor} rounded-lg`;

            let materialsInputHtml = '';
            
            // MODIFIED THIS LINE: Added a check for 'isPendingTabActive'.
            // The materials input will now only show if the customer has responded AND we are NOT on the pending tab.
            // MODIFIED THIS LINE: Added a check for 'isPendingTabActive'.
// The materials input will now only show if the customer has responded AND we are NOT on the pending tab.
if (hasCustomerResponded && isChecked && !isPendingTabActive) {
    // Parse existing materials into an array (split by comma or newline)
    const existingMaterials = (item.materials || '').split(/[,\n]/).map(m => m.trim()).filter(m => m);
    
    materialsInputHtml = `
        <div class="mt-2 pt-2 border-t border-gray-300/50">
            <div class="flex items-center justify-between mb-1">
                <label class="block text-xs font-medium text-gray-600">Material Requirements</label>
                <button type="button" onclick="addMaterialField('${sanitizedText}')" class="p-1 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 shrink-0">
                    <span class="material-symbols-outlined text-sm">add</span>
                </button>
            </div>
            <div id="materials-container-${sanitizedText.replace(/\s+/g, '-')}" class="space-y-1">
                ${existingMaterials.length > 0 
                    ? existingMaterials.map((material, index) => `
                        <div class="flex items-center gap-2">
                            <input type="text" class="form-input !py-1 !px-2 text-sm flex-1" 
                                   value="${material}"
                                   placeholder="e.g., Oil filter, 4L synthetic oil"
                                   oninput="updateMaterialsFromInputs('${sanitizedText}')">
                            <button type="button" onclick="removeMaterialField(this, '${sanitizedText}')" class="p-1 text-red-500 hover:text-red-700 shrink-0">
                                <span class="material-symbols-outlined text-sm">remove</span>
                            </button>
                        </div>
                      `).join('')
                    : `
                        <div class="flex items-center gap-2">
                            <input type="text" class="form-input !py-1 !px-2 text-sm flex-1" 
                                   value=""
                                   placeholder="e.g., Oil filter, 4L synthetic oil"
                                   oninput="updateMaterialsFromInputs('${sanitizedText}')">
                            <button type="button" onclick="removeMaterialField(this, '${sanitizedText}')" class="p-1 text-red-500 hover:text-red-700 shrink-0">
                                <span class="material-symbols-outlined text-sm">remove</span>
                            </button>
                        </div>
                      `
                }
            </div>
        </div>
    `;
}

            approvalItemContainer.innerHTML = `
                <label class="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" class="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" 
                           value=${checkboxValue} 
                           ${isChecked ? 'checked' : ''}
                           onchange="handleCheckboxChange(this)">
                    <div class="flex-1 flex justify-between items-center">
                       <span class="font-medium break-all">${item.text}</span>
                        <span class="font-bold text-gray-800">₹${(item.amount || 0).toFixed(2)}</span>
                    </div>
                    ${tag}
                </label>
                ${materialsInputHtml}
            `;
            customerApprovalList.appendChild(approvalItemContainer);
        });
    } else {
        customerApprovalList.innerHTML = '<p class="text-sm text-gray-500">No complaints or suggestions available for approval.</p>';
    }
    
    recalculateAndUpdateTotal();
}
function addMaterialField(itemText) {
    const sanitizedText = itemText.replace(/\s+/g, '-');
    const container = document.getElementById(`materials-container-${sanitizedText}`);
    
    const newFieldDiv = document.createElement('div');
    newFieldDiv.className = 'flex items-center gap-2';
    newFieldDiv.innerHTML = `
        <input type="text" class="form-input !py-1 !px-2 text-sm flex-1" 
               value=""
               placeholder="e.g., Oil filter, 4L synthetic oil"
               oninput="updateMaterialsFromInputs('${itemText}')">
        <button type="button" onclick="removeMaterialField(this, '${itemText}')" class="p-1 text-red-500 hover:text-red-700 shrink-0">
            <span class="material-symbols-outlined text-sm">remove</span>
        </button>
    `;
    
    container.appendChild(newFieldDiv);
}

function removeMaterialField(buttonElement, itemText) {
    const fieldDiv = buttonElement.parentElement;
    const container = fieldDiv.parentElement;
    
    // Don't remove if it's the only field
    if (container.children.length > 1) {
        fieldDiv.remove();
        updateMaterialsFromInputs(itemText);
    } else {
        // If it's the last field, just clear its value
        const input = fieldDiv.querySelector('input');
        input.value = '';
        updateMaterialsFromInputs(itemText);
    }
}

function updateMaterialsFromInputs(itemText) {
    const sanitizedText = itemText.replace(/\s+/g, '-');
    const container = document.getElementById(`materials-container-${sanitizedText}`);
    
    if (!container) return;
    
    const inputs = container.querySelectorAll('input');
    const materials = Array.from(inputs)
        .map(input => input.value.trim())
        .filter(value => value.length > 0)
        .join(', ');
    
    // Update the item in state
    updateItemMaterials(itemText, materials);
}

// FIND AND REPLACE this entire function
        async function renderSettingsToggles() {
            const container = document.getElementById('settings-container');
            container.innerHTML = '';

            const allReportColumns = [
                { key: 'vehicle_no', label: 'Vehicle No.' }, { key: 'vehicle_name', label: 'Vehicle Name' },
                { key: 'model', label: 'Model' }, { key: 'brand', label: 'Brand' }, { key: 'color', label: 'Color' },
                { key: 'engine_no', label: 'Engine No' }, { key: 'chassis_no', label: 'Chassis No' },
                { key: 'client_name', label: 'Client Name' }, { key: 'client_phone', label: 'Client Phone' },
                { key: 'odometer', label: 'Odometer' }, { key: 'executive', label: 'Executive' },
                { key: 'date_time', label: 'Date & Time' }, { key: 'status', label: 'Status' },
                { key: 'complaint', label: 'Complaint' }, { key: 'suggested', label: 'Suggested' },
                { key: 'approved', label: 'Approved' }, { key: 'feedback_text', label: 'Feedback Text' },
                { key: 'feedback_voice', label: 'Feedback Voice' }, { key: 'marks', label: 'Marks' },
                { key: 'media', label: 'Media' }
            ];

            const settingGroups = {
                "Job Card Page": {
                    "Feature Toggles": [
                        { key: 'enable_vehicle_scanner', type: 'toggle', label: 'Enable Vehicle Number Plate Scanner', description: 'Allows executives to scan number plates.' },
                        { key: 'show_full_vehicle_form', type: 'toggle', label: 'Show Full "Register New Vehicle" Form', description: 'If off, only Vehicle No. and Phone are required.' }
                    ]
                },
                "Report / Service History Page": {
                    "Visible Columns": [
                        { key: 'visible_report_columns', type: 'checkbox_group', label: 'Select columns to display in the service history table.', options: allReportColumns }
                    ]
                }
            };

            const query = sb.from('app_settings').select('*');
            const settingsData = await handleSupabaseQuery(query, 'Could not fetch app settings.');
            if (settingsData === null) return;
            
            const dbSettings = {};
            settingsData.forEach(s => { dbSettings[s.setting_key] = s.setting_value; });

            Object.entries(settingGroups).forEach(([pageTitle, sections]) => {
                const pageCard = document.createElement('div');
                pageCard.className = 'card setting-card';
                pageCard.innerHTML = `<h2 class="text-xl font-bold mb-4 border-b pb-2" data-search-text="${pageTitle}">${pageTitle}</h2>`;
                const sectionsContainer = document.createElement('div');
                sectionsContainer.className = 'space-y-6';

                Object.entries(sections).forEach(([sectionTitle, settings]) => {
                    const sectionDiv = document.createElement('div');
                    sectionDiv.className = 'setting-section';
                    sectionDiv.innerHTML = `<h3 class="text-lg font-semibold text-gray-700" data-search-text="${sectionTitle}">${sectionTitle}</h3>`;
                    
                    settings.forEach(setting => {
                        const settingWrapper = document.createElement('div');
                        settingWrapper.className = 'setting-item pt-3';
                        settingWrapper.dataset.searchText = `${setting.label} ${setting.description || ''}`.toLowerCase();

                        if (setting.type === 'toggle') {
                            const isEnabled = dbSettings[setting.key] === undefined ? true : dbSettings[setting.key];
                            settingWrapper.innerHTML = `
                                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <div>
                                        <p class="font-semibold text-gray-800">${setting.label}</p>
                                        <p class="text-xs text-gray-500">${setting.description}</p>
                                    </div>
                                    <label class="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" ${isEnabled ? 'checked' : ''} class="sr-only peer" onchange="updateSetting('${setting.key}', this.checked)">
                                        <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-blue-300 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                    </label>
                                </div>`;
                        } else if (setting.type === 'checkbox_group') {
                            // --- THIS IS THE FIX ---
                            // Check if the setting is a string before parsing, otherwise use it directly.
                            let visibleColumns = dbSettings[setting.key];
                            if (typeof visibleColumns === 'string') {
                                try {
                                    visibleColumns = JSON.parse(visibleColumns || '[]');
                                } catch (e) { visibleColumns = []; }
                            }
                            visibleColumns = visibleColumns || [];
                            // --- END OF FIX ---

                            const optionsHtml = setting.options.map(opt => `
                                <label class="flex items-center gap-2 p-2 bg-gray-50 rounded-md">
                                    <input type="checkbox" value="${opt.key}" onchange="updateReportColumns()" class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" ${visibleColumns.includes(opt.key) ? 'checked' : ''}>
                                    <span class="text-sm font-medium">${opt.label}</span>
                                </label>
                            `).join('');
                            settingWrapper.innerHTML = `
                                <p class="text-sm text-gray-500 mb-2">${setting.label}</p>
                                <div id="report-columns-checklist" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">${optionsHtml}</div>`;
                        }
                        sectionDiv.appendChild(settingWrapper);
                    });
                    sectionsContainer.appendChild(sectionDiv);
                });
                pageCard.appendChild(sectionsContainer);
                container.appendChild(pageCard);
            });
        }
		
		
async function showQuickAccessModal() {
    showModal('quick-access-modal');
    await populateQuickAccessUsers();
}

// REPLACE this function
async function populateQuickAccessUsers() {
    const container = document.getElementById('quick-access-users');
    container.innerHTML = '<p class="text-center text-gray-500">Loading users...</p>';

    // THE FIX: Added 'inspector' to the list of roles to fetch
    const { data: users, error } = await sb
        .from('users')
        .select('id, username, role, team')
        .in('role', ['executive', 'washer', 'inspector'])
        .order('role', { ascending: true })
        .order('username', { ascending: true });

    if (error) {
        container.innerHTML = '<p class="text-center text-red-500">Error loading users</p>';
        return;
    }

    container.innerHTML = '';

    if (users.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500">No executives, washers, or inspectors found</p>';
        return;
    }

    const executives = users.filter(u => u.role === 'executive');
    const washers = users.filter(u => u.role === 'washer');
    const inspectors = users.filter(u => u.role === 'inspector'); // Added this line

    if (executives.length > 0) {
        // Unchanged...
        const execSection = document.createElement('div');
        execSection.innerHTML = '<h4 class="font-bold text-gray-700 mb-2">Executives</h4>';
        executives.forEach(user => {
            const userBtn = document.createElement('button');
            userBtn.className = 'w-full text-left p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-3';
            let teamHtml = user.team ? `<span class="text-sm font-normal text-gray-600 ml-1">(${user.team})</span>` : '';
            userBtn.innerHTML = `
                <span class="material-symbols-outlined text-blue-600">person</span>
                <div><p class="font-semibold text-gray-800">${user.username} ${teamHtml}</p><p class="text-xs text-gray-500 capitalize">${user.role}</p></div>`;
            userBtn.onclick = () => quickAccessUser(user);
            execSection.appendChild(userBtn);
        });
        container.appendChild(execSection);
    }

    // THE FIX: Added this entire block to display inspectors
    if (inspectors.length > 0) {
        const inspectorSection = document.createElement('div');
        inspectorSection.innerHTML = '<h4 class="font-bold text-gray-700 mb-2 mt-4">Inspectors</h4>';
        inspectors.forEach(user => {
            const userBtn = document.createElement('button');
            userBtn.className = 'w-full text-left p-3 bg-yellow-50 hover:bg-yellow-100 rounded-lg transition-colors flex items-center gap-3';
            userBtn.innerHTML = `
                <span class="material-symbols-outlined text-yellow-600">fact_check</span>
                <div><p class="font-semibold text-gray-800">${user.username}</p><p class="text-xs text-gray-500 capitalize">${user.role}</p></div>`;
            userBtn.onclick = () => quickAccessUser(user);
            inspectorSection.appendChild(userBtn);
        });
        container.appendChild(inspectorSection);
    }

    if (washers.length > 0) {
        // Unchanged...
        const washerSection = document.createElement('div');
        washerSection.innerHTML = '<h4 class="font-bold text-gray-700 mb-2 mt-4">Washers</h4>';
        washers.forEach(user => {
            const userBtn = document.createElement('button');
            userBtn.className = 'w-full text-left p-3 bg-green-50 hover:bg-green-100 rounded-lg transition-colors flex items-center gap-3';
            userBtn.innerHTML = `
                <span class="material-symbols-outlined text-green-600">local_car_wash</span>
                <div><p class="font-semibold text-gray-800">${user.username}</p><p class="text-xs text-gray-500 capitalize">${user.role}</p></div>`;
            userBtn.onclick = () => quickAccessUser(user);
            washerSection.appendChild(userBtn);
        });
        container.appendChild(washerSection);
    }
}

// REPLACE this function
async function quickAccessUser(user) {
    sessionStorage.setItem('originalAdmin', JSON.stringify(currentUser));
    currentUser = user;
    sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
    hideModal('quick-access-modal');
    
    if (user.role === 'executive') {
        document.getElementById('profile-username').textContent = user.username;
        document.getElementById('profile-role').textContent = user.role;
        await fetchAndApplyAppSettings();
        showExecutiveScreen('job-card-screen');
        showSuccessMessage(`Switched to executive: ${user.username}`);
    } else if (user.role === 'washer') {
        showScreen('washer-screen');
        populateWashList();
        showSuccessMessage(`Switched to washer: ${user.username}`);
    } else if (user.role === 'inspector') { // THE FIX: Added this block
        showScreen('inspector-screen');
        populateInspectionQueue();
        showSuccessMessage(`Switched to inspector: ${user.username}`);
    }
}


        // ADD THIS NEW FUNCTION
        async function updateReportColumns() {
            const checklist = document.getElementById('report-columns-checklist');
            const visibleColumns = [];
            checklist.querySelectorAll('input[type="checkbox"]:checked').forEach(checkbox => {
                visibleColumns.push(checkbox.value);
            });
            
            // The value we save to Supabase is a JSON string of the array
            const { error } = await sb.from('app_settings')
                .update({ setting_value: JSON.stringify(visibleColumns) })
                .eq('setting_key', 'visible_report_columns');
            
            if (error) {
                showError('Failed to update column settings.', error);
            } else {
                showSuccessMessage('Column visibility updated!');
                appSettings.visible_report_columns = visibleColumns; // Update local cache
            }
        }

        // ADD THIS NEW FUNCTION
        function filterSettings() {
            const searchTerm = document.getElementById('settings-search-input').value.toLowerCase();
            document.querySelectorAll('.setting-item').forEach(item => {
                const isVisible = item.dataset.searchText.includes(searchTerm);
                item.style.display = isVisible ? 'block' : 'none';
            });
        }
		
		

        async function updateSetting(key, value) {
            const { error } = await sb
                .from('app_settings')
                .upsert({ setting_key: key, setting_value: value }, { onConflict: 'setting_key' });

            if (error) {
                showError(`Failed to update setting: ${error.message}`);
                renderSettingsToggles();
            } else {
                showSuccessMessage('Setting updated!');
                appSettings[key] = value;
            }
        }

// FIND AND REPLACE this function
        async function fetchAndApplyAppSettings() {
            // Set defaults first
            appSettings = { 
                enable_vehicle_scanner: true, 
                show_full_vehicle_form: true,
                visible_report_columns: ['vehicle_no', 'client_name', 'executive', 'date_time', 'status', 'media'] // Sensible default
            };

            const query = sb.from('app_settings').select('*');
            const settingsData = await handleSupabaseQuery(query, "Failed to load app settings.");
            
            if (settingsData) {
                settingsData.forEach(setting => {
                    // This correctly handles booleans and the JSON string for columns
                    try {
                        appSettings[setting.setting_key] = (typeof setting.setting_value === 'string' && (setting.setting_value.startsWith('[') || setting.setting_value.startsWith('{')))
                            ? JSON.parse(setting.setting_value)
                            : setting.setting_value;
                    } catch (e) {
                        console.error(`Failed to parse setting ${setting.setting_key}`, e);
                    }
                });
            }
            applyFeatureToggles();
        }


// REPLACE this function
function applyFeatureToggles() {
    const scannerButton = document.querySelector("button[onclick=\"document.getElementById('image-upload-input').click()\"]");
    if (scannerButton) {
        scannerButton.style.display = appSettings.enable_vehicle_scanner ? 'flex' : 'none';
    }

    const form = document.getElementById('create-vehicle-form');
    if (form) {
        // THE FIX: 'new-client-name' has been removed from this list so it's never hidden.
        const fieldsToToggle = [
            'new-vehicle-name', 'new-vehicle-brand-exec', 'new-vehicle-model-exec', 
            'new-color', 'new-fuel-type', 'new-engine-no', 'new-chassis-no', 
            'new-odometer'
        ];
        const showFullForm = appSettings.show_full_vehicle_form === true;
        fieldsToToggle.forEach(fieldId => {
            const input = document.getElementById(fieldId);
            const wrapper = input.parentElement;
            if (wrapper) {
                wrapper.style.display = showFullForm ? 'block' : 'none';
            }
            if (input) {
                input.required = showFullForm;
            }
        });
    }
}






// Replace your showUpdateTab function with this simpler version
function showUpdateTab(tabName) {
    document.querySelectorAll('#update-tab-container .tab-button').forEach(btn => btn.classList.remove('active-tab'));
    document.querySelectorAll('#update-tab-container .tab-panel').forEach(panel => panel.classList.add('hidden'));

    const tabMap = {
        'pending': { btn: 'tab-btn-pending', panel: 'pending-jobs-panel', func: populateNotStartedJobs },
        'awaiting': { btn: 'tab-btn-awaiting', panel: 'awaiting-response-panel', func: populateAwaitingResponseJobs },
        'responses': { btn: 'tab-btn-responses', panel: 'responses-received-panel', func: populateCustomerResponseJobs }
    };

    if (tabMap[tabName]) {
        document.getElementById(tabMap[tabName].btn).classList.add('active-tab');
        document.getElementById(tabMap[tabName].panel).classList.remove('hidden');
        tabMap[tabName].func();
    }
}

// Replace your saveVehicleUpdate function to revert to the 'Ongoing' status
async function saveVehicleUpdate(shouldReset = true) {
    if (!currentReportId) return showError('No report selected for update.');

    const deliveryDate = document.getElementById('delivery-date').value;
    if (!deliveryDate) return showError('Please select an expected delivery date.');

    const approvedItems = [];
    document.querySelectorAll('#customer-approval-list input[type="checkbox"]:checked').forEach(checkbox => {
        try { approvedItems.push(JSON.parse(checkbox.value)); } catch (e) {}
    });

    const allItemsForApproval = [...originalComplaintsForUpdate, ...newSuggestions];

    const updateData = {
        complaint: JSON.stringify(originalComplaintsForUpdate),
        suggested: JSON.stringify(allItemsForApproval),
        approved: JSON.stringify(approvedItems),
        status: 'Ongoing', // Reverted to 'Ongoing'
        expected_delivery: deliveryDate
    };
    
    const { error } = await sb.from('reports').update(updateData).eq('id', currentReportId);
    if (error) return showError(`Failed to save update: ${error.message}`);

    showSuccessMessage('Update saved successfully!');
    resetVehicleUpdateScreen();
}


                
// REPLACE this entire function
async function sendApprovalLink() {
    if (!currentReportId) {
        return showError('No report is currently selected.');
    }

    try {
        // 1. Give the user immediate feedback that something is happening.
        showSuccessMessage('Saving and preparing link...');

        // 2. Combine and save all required data to the database first.
        const allItemsForApproval = [
            ...originalComplaintsForUpdate,
            ...newSuggestions
        ];
        const { error: saveDataError } = await sb.from('reports')
            .update({
                suggested: JSON.stringify(allItemsForApproval),
                status: 'Ongoing'
            })
            .eq('id', currentReportId);

        if (saveDataError) {
            // If saving fails, stop here and show an error.
            throw saveDataError;
        }

        // 3. Fetch the report data again to get the client's phone number.
        const { data: reportData, error: reportError } = await sb
            .from('reports')
            .select('client_phone, vehicles(*)')
            .eq('id', currentReportId)
            .single();

        if (reportError) {
            throw reportError;
        }

        // 4. Explicitly check if a phone number exists.
        const clientPhone = reportData.client_phone || reportData.vehicles?.client_phone;
        if (!clientPhone) {
            // This is a clear error message instead of getting stuck.
            return showError("Cannot send: Client phone number is missing for this job card.");
        }

        // 5. Construct the final URL.
        const approvalUrl = `${window.location.origin}${window.location.pathname}?report_id=${currentReportId}`;
        const messageText = `Dear Customer,\n\nPlease review and approve the suggested repairs for your vehicle using the link below:\n${approvalUrl}\n\nThank you,\nAutoFix Service`;
        const encodedText = encodeURIComponent(messageText);
        const whatsappUrl = `https://wa.me/91${clientPhone}?text=${encodedText}`;

        // 6. **THE FIX:** Use window.location.href for better mobile compatibility.
        window.location.href = whatsappUrl;

        showSuccessMessage("Approval link sent! Job moved to 'Awaiting Response'.");
        resetVehicleUpdateScreen();

    } catch (error) {
        // This will catch any error from the steps above.
        console.error('Error in sendApprovalLink:', error);
        showError(`An error occurred: ${error.message}`);
    }
}


        async function populateNotStartedJobs() {
            if (!currentUser) {
                console.error("populateNotStartedJobs: currentUser is null. Cannot fetch data.");
                document.getElementById('no-pending-jobs-message').classList.remove('hidden');
                return; 
            }

            const listContainer = document.getElementById('not-started-jobs-list');
            const noJobsMsg = document.getElementById('no-pending-jobs-message');
            listContainer.innerHTML = '';
            noJobsMsg.classList.add('hidden');

            const { data: reports, error } = await sb.from('reports')
                .select(`id, created_at, complaint, approved, suggested, customer_feedback_text, customer_feedback_audio, vehicles!inner(vehicle_no, vehicle_name, color, vehicle_models(brand, model))`)
                .eq('executive_id', currentUser.id)
                .eq('status', 'Not Started')
                .order('created_at', { ascending: false });

            if (error) {
                console.error("Error fetching not started jobs:", error);
                showError('Could not fetch pending job cards.');
                return;
            }

            if (!reports || reports.length === 0) {
                noJobsMsg.classList.remove('hidden');
                return;
            }

            updateableReportsStore = {};
            reports.forEach(report => {
                updateableReportsStore[report.id] = report;
                const card = document.createElement('div');
                const vehicle = report.vehicles;

                const brand = vehicle.vehicle_models ? vehicle.vehicle_models.brand : '';
                const model = vehicle.vehicle_models ? vehicle.vehicle_models.model : '';
                const vehicleName = vehicle.vehicle_name || '';
                const color = vehicle.color || '';
                
                const createdDate = new Date(report.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric'
                });

                const brandAndModel = `${brand} ${model}`.trim();
                const descriptionParts = [vehicleName, brandAndModel, color].filter(part => part);
                const description = descriptionParts.join(' &bull; '); 

                card.className = 'p-4 border border-gray-200 rounded-lg hover:shadow-md hover:border-blue-500 transition-all flex justify-between items-center';

                // THE FIX IS IN THE <p> TAG FOR THE COMPLAINT BELOW
                card.innerHTML = `
                    <div class="flex-grow cursor-pointer" onclick="selectReportForUpdateById(${report.id})">
                        <div class="flex items-center gap-4">
                            <p class="font-bold text-gray-800">${vehicle.vehicle_no}</p>
                            <p class="text-xs font-medium text-gray-500">${createdDate}</p>
                        </div>
                        <p class="text-sm text-gray-600 mt-1">${description}</p>
                        <p class="text-xs text-gray-500 mt-1 break-words"><strong>Complaint:</strong> ${formatArrayCell(report.complaint)}</p>
                    </div>
                    <div class="menu-container">
                        <button class="menu-button p-2 rounded-full hover:bg-gray-100">
                            <span class="material-symbols-outlined text-gray-500">more_vert</span>
                        </button>
                        <div class="dropdown-menu">
                            <a onclick="openCancelModal(${report.id}, '${vehicle.vehicle_no}')" class="dropdown-item">
                                <span class="material-symbols-outlined text-red-500">cancel</span>
                                <span>Cancel Job</span>
                            </a>
                        </div>
                    </div>
                `;

                listContainer.appendChild(card);
            });
        }



        async function populateCustomerResponseJobs() {
            const listContainer = document.getElementById('customer-response-list');
            const noJobsMsg = document.getElementById('no-customer-response-message');
            listContainer.innerHTML = '';
            noJobsMsg.classList.add('hidden');

            const { data: reports, error } = await sb.from('reports')
                .select(`id, complaint, approved, suggested, customer_feedback_text, customer_feedback_audio, vehicles!inner(vehicle_no, vehicle_name, color, vehicle_models(brand, model))`)
                .eq('executive_id', currentUser.id)
                .eq('status', 'Ongoing')
                .not('approved', 'is', null)
                .neq('approved', '[]')
                .order('created_at', { ascending: false });

            if (error) {
                console.error("Error fetching customer response jobs:", error);
                return showError('Could not fetch jobs with customer responses.');
            }

            if (!reports || reports.length === 0) {
                noJobsMsg.classList.remove('hidden');
                return;
            }

            reports.forEach(report => {
                updateableReportsStore[report.id] = report;
                const card = document.createElement('div');
                const approvedCount = (JSON.parse(report.approved || '[]')).length;

                card.className = 'p-4 border border-gray-200 rounded-lg hover:shadow-md hover:border-green-500 transition-all flex justify-between items-center';
                const vehicle = report.vehicles;
                const brand = vehicle.vehicle_models ? vehicle.vehicle_models.brand : '';
                const model = vehicle.vehicle_models ? vehicle.vehicle_models.model : '';

                card.innerHTML = `
                    <div class="flex-grow cursor-pointer" onclick="selectReportForUpdateById(${report.id})">
                        <div class="flex justify-between items-center">
                            <p class="font-bold text-gray-800">${vehicle.vehicle_no}</p>
                            <p class="text-xs text-gray-500 italic">${brand} ${model}</p>
                        </div>
                        <p class="text-sm text-green-700 font-semibold mt-1">${approvedCount} service(s) approved</p>
                    </div>
                    <div class="menu-container">
                        <button class="menu-button p-2 rounded-full hover:bg-gray-100">
                            <span class="material-symbols-outlined text-gray-500">more_vert</span>
                        </button>
                        <div class="dropdown-menu">
                            <a onclick="openCancelModal(${report.id}, '${vehicle.vehicle_no}')" class="dropdown-item">
                                <span class="material-symbols-outlined text-red-500">cancel</span>
                                <span>Cancel Job</span>
                            </a>
                        </div>
                    </div>
                `;
                listContainer.appendChild(card);
            });
        }

        async function populateAwaitingResponseJobs() {
            const listContainer = document.getElementById('awaiting-response-list');
            const noJobsMsg = document.getElementById('no-awaiting-response-message');
            listContainer.innerHTML = '';
            noJobsMsg.classList.add('hidden');

            const { data: reports, error } = await sb.from('reports')
                .select(`id, complaint, approved, suggested, customer_feedback_text, customer_feedback_audio, vehicles!inner(vehicle_no, vehicle_name, color, vehicle_models(brand, model))`)
                .eq('executive_id', currentUser.id)
                .eq('status', 'Ongoing')
                .not('suggested', 'is', null)
                .or('approved.is.null,approved.eq.[]') 
                .order('created_at', { ascending: false });

            if (error) {
                console.error("Error fetching awaiting response jobs:", error);
                return showError('Could not fetch jobs awaiting customer response.');
            }

            if (!reports || reports.length === 0) {
                noJobsMsg.classList.remove('hidden');
                return;
            }

            reports.forEach(report => {
                updateableReportsStore[report.id] = report; // Store it
                const card = document.createElement('div');
                const vehicle = report.vehicles;
                const brand = vehicle.vehicle_models ? vehicle.vehicle_models.brand : '';
                const model = vehicle.vehicle_models ? vehicle.vehicle_models.model : '';

                card.className = 'p-4 border border-gray-200 rounded-lg hover:shadow-md hover:border-blue-500 transition-all flex justify-between items-center';
                card.innerHTML = `
                    <div class="flex-grow cursor-pointer" onclick="selectReportForUpdateById(${report.id})">
                        <div class="flex justify-between items-center w-full">
                             <p class="font-bold text-gray-800">${vehicle.vehicle_no}</p>
                             <p class="text-xs text-gray-500 italic ml-4">${brand} ${model}</p>
                        </div>
                        <p class="text-sm text-blue-700 font-semibold mt-1">Approval sent to customer</p>
                    </div>
                     <div class="menu-container">
                        <button class="menu-button p-2 rounded-full hover:bg-gray-100">
                            <span class="material-symbols-outlined text-gray-500">more_vert</span>
                        </button>
                        <div class="dropdown-menu">
                            <a onclick="openCancelModal(${report.id}, '${vehicle.vehicle_no}')" class="dropdown-item">
                                <span class="material-symbols-outlined text-red-500">cancel</span>
                                <span>Cancel Job</span>
                            </a>
                        </div>
                    </div>
                `;
                listContainer.appendChild(card);
            });
        }		
		
        

        
        async function updateJobStatus(id, newStatus, vehicleNo) {
            if (newStatus === 'Completed') {
                document.getElementById('complete-modal-text').textContent = `Are you sure you want to mark the job for vehicle ${vehicleNo} as completed?`;
                document.getElementById('confirm-complete-button').onclick = () => handleCompletionConfirmation(id, vehicleNo);
                showModal('complete-confirmation-modal');
            } else {
                const { error } = await sb.from('reports').update({ status: newStatus }).eq('id', id);
                if(error) return showError('Failed to update status.');

                showSuccessMessage(`Status for ${vehicleNo} updated to ${newStatus}`);
                setTimeout(populateDueDateScreen, 500);
            }
        }

// Find and replace this entire function
        async function handleCompletionConfirmation(id, vehicleNo) {
            const confirmationInput = document.getElementById('complete-confirmation-input');
            if (confirmationInput.value.trim().toLowerCase() !== 'yes') {
                return showError("Confirmation text did not match. Please type 'yes' to proceed.");
            }
            
            const { error } = await sb.from('reports').update({ status: 'Completed' }).eq('id', id);
            confirmationInput.value = ''; 
            hideModal('complete-confirmation-modal'); 
            
            if(error) {
                return showError('Failed to update status.');
            }
            
            showSuccessMessage(`Job for ${vehicleNo} marked as Completed!`);
            
            const { data: reportData, error: fetchError } = await sb
                .from('reports')
                .select('client_phone')
                .eq('id', id)
                .single();

            if (fetchError || !reportData || !reportData.client_phone) {
                console.error("Could not fetch client phone number for feedback message.", fetchError);
                showCloseTab('complete'); // REPLACED: Refresh the new "Complete" tab
                return;
            }

            const clientPhone = reportData.client_phone;
            const sendButton = document.getElementById('confirm-feedback-send-button');
            sendButton.onclick = () => sendWhatsAppFeedback(id, clientPhone, vehicleNo);
            showModal('whatsapp-feedback-modal');
            
            showCloseTab('complete'); // REPLACED: Refresh the new "Complete" tab in the background
        }

function sendWhatsAppFeedback(reportId, clientPhone, vehicleNo) {
    // This creates a unique link back to the application for feedback
    const feedbackUrl = `${window.location.origin}${window.location.pathname}?feedback_id=${reportId}`;
    const messageText = `Dear Customer,
Thank you for choosing AutoFix for your vehicle ${vehicleNo}.
We would be grateful if you could share your experience with us by clicking the link below:
${feedbackUrl}
Your feedback helps us improve our service.`;
    const encodedText = encodeURIComponent(messageText);
    const whatsappUrl = `https://wa.me/91${clientPhone}?text=${encodedText}`;
    window.open(whatsappUrl, '_blank');
    hideModal('whatsapp-feedback-modal');
}

// START: Add these two new functions
async function loadFeedbackScreen(feedbackId) {
    // Hide all other screens and show the feedback screen
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.getElementById('customer-feedback-screen').classList.add('active-screen');
    // Fetch the vehicle number to display it on the page for context
    const { data, error } = await sb
        .from('reports')
        .select('vehicles(vehicle_no)')
        .eq('id', feedbackId)
        .single();
    if (error || !data) {
        console.error('Error fetching report for feedback:', error);
        document.getElementById('feedback-form-content').innerHTML = '<p class="text-center text-red-600">Could not load report details. The link may be invalid.</p>';
        return;
    }
    document.getElementById('feedback-vehicle-no').textContent = data.vehicles.vehicle_no;
}

async function submitCustomerTextFeedback() {
    const params = new URLSearchParams(window.location.search);
    const feedbackId = params.get('feedback_id');
    if (!feedbackId) {
        return alert("Error: Report ID not found. Your session may be invalid.");
    }
    const feedbackText = document.getElementById('customer-feedback-input').value.trim();
    if (!feedbackText) {
        return alert('Please enter your feedback before submitting.');
    }
    // Update the 'customer_feedback_text' column in the 'reports' table
    const { error } = await sb
        .from('reports')
        .update({ customer_feedback_text: feedbackText })
        .eq('id', feedbackId);
    if (error) {
        console.error('Error submitting feedback:', error);
        return alert('Sorry, there was an error submitting your feedback. Please try again.');
    }
    // On success, hide the form and show the thank you message
    document.getElementById('feedback-form-content').classList.add('hidden');
    document.getElementById('feedback-success-message').classList.remove('hidden');
}
// END: Add these two new functions
// ADD THIS NEW FUNCTION
// Updates the materials for a specific complaint or suggestion in the state arrays.
function updateItemMaterials(text, newMaterials) {
    // Search in both original complaints and new suggestions to find the correct item
    let item = originalComplaintsForUpdate.find(c => c.text === text);
    if (!item) {
        item = newSuggestions.find(s => s.text === text);
    }
    
    if (item) {
        item.materials = newMaterials.trim();
    }
}
// Find and replace this entire function
        function cancelCompletion() {
            document.getElementById('complete-confirmation-input').value = '';
            hideModal('complete-confirmation-modal');
            // REPLACED: Refresh the appropriate tab instead of calling the old function
            const activeTab = document.querySelector('#due-date-screen .tab-button.active-tab');
            if (activeTab && activeTab.id === 'tab-btn-complete') {
                showCloseTab('complete');
            } else {
                showCloseTab('wash-pending');
            }
        }
        
        function openCancelModal(reportId, vehicleNo) {
            document.getElementById('cancel-modal-text').textContent = `Are you sure you want to cancel the job for vehicle ${vehicleNo}? This action cannot be undone.`;
            document.getElementById('confirm-cancel-button').onclick = () => executeCancellation(reportId, vehicleNo);
            showModal('cancel-confirmation-modal');
        }

        async function executeCancellation(reportId, vehicleNo) {
            const confirmationInput = document.getElementById('cancel-confirmation-input');
            if (confirmationInput.value.trim().toLowerCase() !== 'cancel') {
                return showError("Confirmation text did not match. Please type 'cancel' to proceed.");
            }

            const { error } = await sb.from('reports').update({ status: 'Cancelled' }).eq('id', reportId);

            confirmationInput.value = '';
            hideModal('cancel-confirmation-modal');

            if (error) {
                return showError(`Failed to cancel job: ${error.message}`);
            }

            showSuccessMessage(`Job for ${vehicleNo} has been cancelled.`);
            // Refresh the current tab view
            const activeTab = document.querySelector('.tab-button.active-tab');
            if (activeTab) {
                if (activeTab.id === 'tab-btn-pending') populateNotStartedJobs();
                else if (activeTab.id === 'tab-btn-awaiting') populateAwaitingResponseJobs();
                else if (activeTab.id === 'tab-btn-responses') populateCustomerResponseJobs();
            }
        }

        function closeCancelModal() {
            document.getElementById('cancel-confirmation-input').value = '';
            hideModal('cancel-confirmation-modal');
        }

        async function resetPassword() {
            const currentPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmNewPassword = document.getElementById('confirm-new-password').value;

            if (newPassword !== confirmNewPassword) return showError('New passwords do not match.');
            if (currentUser.password !== currentPassword) return showError('Incorrect current password.');

            const { error } = await sb.from('users').update({ password: newPassword }).eq('id', currentUser.id);
            if (error) return showError('Could not reset password.');

            showSuccessMessage('Password reset successfully!');
            currentUser.password = newPassword; 
            sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
            document.querySelector('#profile-screen form').reset();
        }

        function confirmDeletion(type, id, role) {
            const modal = document.getElementById('delete-confirmation-modal');
            const text = document.getElementById('delete-modal-text');
            const button = document.getElementById('confirm-delete-button');
            
            let message = '';
            if (type === 'user') message = `Are you sure you want to delete this ${role}? This action cannot be undone.`;
            else if (type === 'vehicle_model') message = `Are you sure you want to delete this vehicle model? This may affect existing records.`;
            
            text.textContent = message;
            button.onclick = () => executeDelete(type, id, role);
            showModal('delete-confirmation-modal');
        }

        async function executeDelete(type, id, role) {
            let error;
            if (type === 'user') {
                ({ error } = await sb.from('users').delete().eq('id', id));
            } else if (type === 'vehicle_model') {
                ({ error } = await sb.from('vehicle_models').delete().eq('id', id));
            }

            hideModal('delete-confirmation-modal');
            if(error) return showError(`Deletion failed: ${error.message}`);

            showSuccessMessage('Item deleted successfully.');
            if (type === 'user') renderUserList(role);
            if (type === 'vehicle_model') renderVehicleModelList();
        }

        const formatArrayCell = (jsonString) => {
            if (!jsonString || jsonString === '[]') return 'N/A';
            try {
                const arr = JSON.parse(jsonString);
                if (Array.isArray(arr) && arr.length > 0) {
                    // Check if the items are objects with a 'text' property
                    if (typeof arr[0] === 'object' && arr[0] !== null && 'text' in arr[0]) {
                        return arr.map(item => item.text).join(', ');
                    }
                    // Fallback for arrays of simple strings
                    return arr.join(', ');
                }
                return 'N/A';
            } catch (e) {
                return jsonString;
            }
        };

        function hideAllSections() {
            vehicleDetailsSection.classList.add('hidden');
            createVehicleSection.classList.add('hidden');
            newComplaintSection.classList.add('hidden');
            searchError.classList.add('hidden');
        }

        function resetJobCardState() {
            hideAllSections();
            document.getElementById('search-vehicle-number').value = '';
            document.getElementById('create-vehicle-form').reset();
            currentVehicleId = null;
            currentComplaints = [];
            renderComplaints();
            document.getElementById('client-name-wrapper').innerHTML = `<p id="detail-client-name" class="font-semibold"></p>`;
            document.getElementById('client-phone-wrapper').innerHTML = `<p id="detail-client-phone" class="font-semibold"></p>`;
            document.getElementById('odometer-display-wrapper').innerHTML = `<p id="detail-odometer" class="font-semibold"></p>`;
            clearDamageCanvas();
            capturedPhotos = [];
            voiceNoteBlob = null;
            document.getElementById('photo-previews').innerHTML = '';
            document.getElementById('audio-playback').innerHTML = '';
            document.getElementById('recording-status').textContent = '';
        }

function selectReportForUpdate(report) {
            hasCustomerApproval = false; // Reset flag for each new selection
	    const complaintsSection = document.getElementById('customer-complaints-update-section');
            const isResponsesTabActive = document.getElementById('tab-btn-responses').classList.contains('active-tab');

            if (isResponsesTabActive) {
                complaintsSection.classList.add('hidden');
            } else {
                complaintsSection.classList.remove('hidden');
            }
            
            document.getElementById('update-tab-container').classList.add('hidden');
            
            currentReportId = report.id;
            
            document.getElementById('update-detail-number').textContent = report.vehicles.vehicle_no;
            updateDetailsSection.classList.remove('hidden');
            updateFormSection.classList.remove('hidden');

        try {
            const suggestedItems = report.suggested ? JSON.parse(report.suggested) : null;

            if (suggestedItems && suggestedItems.length > 0) {
                originalComplaintsForUpdate = suggestedItems.filter(item => item.type === 'complaint');
                newSuggestions = suggestedItems.filter(item => item.type === 'suggestion');
            } else {
                let parsedComplaints = JSON.parse(report.complaint || '[]');
                originalComplaintsForUpdate = parsedComplaints.map(c => 
                    typeof c === 'string' ? { text: c, amount: 0, type: 'complaint' } : c
                );
                newSuggestions = [];
            }
        } catch (e) {
            console.error("Error parsing complaint/suggestion data:", e);
            originalComplaintsForUpdate = [];
            newSuggestions = [];
        }

            const approvedItems = report.approved ? JSON.parse(report.approved) : [];
            
            if (approvedItems && approvedItems.length > 0) {
                hasCustomerApproval = true;
            }
            
            renderSuggestions(originalComplaintsForUpdate, newSuggestions, approvedItems);

            const isResponseReceived = approvedItems && approvedItems.length > 0;
            if (isResponseReceived) {
                const totalAmountEl = document.getElementById('approx-total-amount');
                let totalAmount = 0;
                approvedItems.forEach(item => {
                    if (item && typeof item.amount === 'number') {
                        totalAmount += item.amount;
                    }
                });
                totalAmountEl.textContent = `₹ ${totalAmount.toFixed(2)}`;
            }

            const complaintDisplayList = document.getElementById('original-complaints-list');
            const complaintSummaryP = document.getElementById('update-detail-complaint');
            const complaintDisplayDiv = document.getElementById('original-complaints-display');
            complaintDisplayList.innerHTML = '';

            if (originalComplaintsForUpdate.length > 0) {
                complaintSummaryP.textContent = `${originalComplaintsForUpdate.length} issue(s) registered.`;
                originalComplaintsForUpdate.forEach(complaint => {
                    const li = document.createElement('li');
                    li.textContent = complaint.text;
					li.classList.add('break-all');
                    complaintDisplayList.appendChild(li);
                });
                complaintDisplayDiv.classList.remove('hidden');
            } else {
                complaintSummaryP.textContent = 'No complaints registered.';
                complaintDisplayDiv.classList.add('hidden');
            }

            const feedbackDisplay = document.getElementById('customer-feedback-display');
            const feedbackTextDisplay = document.getElementById('customer-feedback-text-display');
            const feedbackAudioDisplay = document.getElementById('customer-feedback-audio-display');

            feedbackDisplay.classList.add('hidden');
            feedbackTextDisplay.classList.add('hidden');
            feedbackAudioDisplay.classList.add('hidden');
            feedbackTextDisplay.textContent = '';
            feedbackAudioDisplay.innerHTML = '';

            if (report.customer_feedback_text || report.customer_feedback_audio) {
                feedbackDisplay.classList.remove('hidden');
                if (report.customer_feedback_text) {
                    feedbackTextDisplay.textContent = report.customer_feedback_text;
                    feedbackTextDisplay.classList.remove('hidden');
                }
                if (report.customer_feedback_audio) {
                    feedbackAudioDisplay.innerHTML = `<audio controls src="${report.customer_feedback_audio}" class="w-full"></audio>`;
                    feedbackAudioDisplay.classList.remove('hidden');
                }
            }

            document.getElementById('delivery-date').value = report.expected_delivery || '';
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('delivery-date').setAttribute('min', today);

            const whatsappButton = document.getElementById('send-whatsapp-btn');
            if (report.approved && report.approved !== '[]') {
                whatsappButton.style.display = 'none';
            } else {
                whatsappButton.style.display = 'flex';
            }
        }

        function selectReportForUpdateById(reportId) {
            const report = updateableReportsStore[reportId];
            if (report) {
                selectReportForUpdate(report);
            } else {
                console.error(`Report with ID ${reportId} not found in store.`);
                showError("Could not load report details. Please try again.");
            }
        }



function resetVehicleUpdateScreen() {
            document.getElementById('update-details-section').classList.add('hidden');
            document.getElementById('update-form-section').classList.add('hidden');
            document.getElementById('update-tab-container').classList.remove('hidden');
            document.getElementById('delivery-date').value = '';
            newSuggestions = [];
            currentReportId = null;
            renderSuggestions();
            // Always show the default 'pending' tab when the screen is reset
            showUpdateTab('pending');
        }
		
		
        // --- Damage Marking Functions ---
        function resizeCanvas() {
            if (!carImage || !damageCanvas || !checkCanvas) return;

            const redraw = () => {
                const w = carImage.clientWidth;
                const h = carImage.clientHeight;
                if (w === 0 || h === 0) return;

                damageCanvas.width = w;
                damageCanvas.height = h;
                checkCanvas.width = w;
                checkCanvas.height = h;

                checkCtx.drawImage(carImage, 0, 0, w, h);
                redrawDamageMarks(damageCanvas, damageMarks);
            };

            requestAnimationFrame(redraw);
        }

        function undoLastMark() {
            if (damageMarks.length > 0) {
                damageMarks.pop();
                redrawDamageMarks(damageCanvas, damageMarks);
            }
        }

        function clearDamageCanvas() {
            if (damageCtx) {
                damageCtx.clearRect(0, 0, damageCanvas.width, damageCanvas.height);
            }
            damageMarks = [];
        }

        function redrawDamageMarks(canvas, marks) {
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (!marks) return;

            marks.forEach(mark => {
                ctx.fillStyle = "red";
                ctx.beginPath();
                ctx.arc(mark.x, mark.y, 5, 0, Math.PI * 2);
                ctx.fill();
            });
        }
        
        function openMarksModal(marks) {
            const marksArray = typeof marks === 'string' ? JSON.parse(marks) : marks;
            
            const modal = document.getElementById("marks-modal");
            modal.classList.remove("modal-hidden");
            const modalCanvas = document.getElementById("modalCanvas");
            const modalImage = document.getElementById("modalCarImage");

            const drawOnModal = () => {
                modalCanvas.width = modalImage.clientWidth;
                modalCanvas.height = modalImage.clientHeight;
                redrawDamageMarks(modalCanvas, marksArray);
            };

            if (modalImage.complete) {
                drawOnModal();
            } else {
                modalImage.onload = drawOnModal;
            }
        }

        function closeMarksModal() {
            document.getElementById("marks-modal").classList.add("modal-hidden");
        }
        
        function showScreen(screenId) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen')); document.getElementById(screenId).classList.add('active-screen'); }
        
function showAdminScreen(screenId) {
    document.querySelectorAll('#admin-screens .admin-screen').forEach(s => s.style.display = 'none');
    document.getElementById(screenId).style.display = 'block';
    
    if (screenId === 'admin-vehicle-management-screen') renderVehicleModelList();
    if (screenId === 'admin-reports-screen') fetchAndPopulateReports(true);
    if (screenId === 'admin-analytics-screen') { populateAnalyticsFilters(); renderAnalytics(); }
    if (screenId === 'admin-executive-management-screen') renderUserList('executive');
    if (screenId === 'admin-admin-management-screen') renderUserList('admin');
    if (screenId === 'admin-washer-management-screen') renderUserList('washer');
    if (screenId === 'admin-inspector-management-screen') renderUserList('inspector'); // ADDED THIS LINE
    if (screenId === 'admin-settings-screen') renderSettingsToggles();
    
    showScreen('admin-screens');
}


// Replace the existing function with this complete version
function showExecutiveScreen(screenId) {
    document.querySelectorAll('#executive-screens .executive-screen').forEach(s => s.style.display = 'none');
    document.getElementById(screenId).style.display = 'block';
    setActiveNav(screenId);

    if (screenId === 'report-screen') fetchAndPopulateReports(false);
    
    // THE FIX: The default tab is now 'ready-to-close'
    if (screenId === 'due-date-screen') showCloseTab('ready-to-close'); 
    
    if (screenId === 'job-card-screen') {
        resetJobCardState();
    }
    if (screenId === 'vehicle-update-screen') {
        resetVehicleUpdateScreen();
    }

    showScreen('executive-screens');
}

        function setActiveNav(targetId) {
            const headerTitle = document.getElementById('executive-header-title');
            document.querySelectorAll('.nav-item').forEach(item => {
                const isActive = item.dataset.target === targetId;
                item.classList.toggle('active', isActive);
                if (isActive) {
                    headerTitle.textContent = item.querySelector('span:last-child').textContent;
                }
            });
        }
        
        function showModal(id) { document.getElementById(id)?.classList.remove('modal-hidden'); }
        function hideModal(id) { document.getElementById(id)?.classList.add('modal-hidden'); }
        
        function showSuccessMessage(message) {
            const el = document.getElementById('success-message');
            document.getElementById('success-text').textContent = message;
            el.classList.remove('hidden');
            setTimeout(() => el.classList.add('hidden'), 3000);
        }

function showError(message, errorObject = null) {
            // Log the full error object to the console for debugging, if it's provided.
            if (errorObject) {
                console.error(`Error shown to user: "${message}"`, errorObject);
            }

            const el = document.getElementById('error-message');
            document.getElementById('error-text').textContent = message;
            el.classList.remove('hidden');
            setTimeout(() => el.classList.add('hidden'), 4000);
        }
		
// ADD THIS NEW HELPER FUNCTION
        async function handleSupabaseQuery(queryPromise, errorMessage) {
            const { data, error } = await queryPromise;
            if (error) {
                showError(errorMessage, error);
                return null; // Return null to signal that the operation failed
            }
            return data;
        }

        // --- Google Drive API Functions ---
        
        async function initializeGapiClient() {
            await gapi.client.init({
                apiKey: API_KEY,
                discoveryDocs: DISCOVERY_DOCS,
            });
            gapiInited = true;
            checkInitialAuth();
        }

        function checkInitialAuth() {
            if (gapiInited && gisInited && sessionStorage.getItem('currentUser')) {
                updateAuthUI(gapi.client.getToken() !== null);
            }
        }
        
        function updateAuthUI(isSignedIn) {
            const authButton = document.getElementById('auth-button');
            const signOutButton = document.getElementById('signout-button');
            if(authButton && signOutButton) {
                if (isSignedIn) {
                    signOutButton.classList.remove('hidden');
                    authButton.textContent = 'Google Drive Authorized';
                    authButton.disabled = true;
                } else {
                    signOutButton.classList.add('hidden');
                    authButton.textContent = 'Authorize Google Drive';
                    authButton.disabled = false;
                }
            }
        }

        function handleAuthClick() {
            if (gapi.client.getToken() === null) {
                tokenClient.requestAccessToken({prompt: 'consent'});
            }
        }
        function handleSignoutClick() {
    if (typeof gapi === 'undefined' || !gapi.client) {
        console.log('Google API not loaded');
        return;
    }
    
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken('');
            updateAuthUI(false);
        });
    }
}
        async function createDriveFolder(folderName) {
            const fileMetadata = {
                'name': folderName,
                'mimeType': 'application/vnd.google-apps.folder',
                'parents': [PARENT_FOLDER_ID]
            };
            const response = await gapi.client.drive.files.create({
                resource: fileMetadata,
                fields: 'id'
            });
            return response.result.id;
        }
        async function uploadFileToDrive(folderId, file, fileName) {
            const metadata = {
                name: fileName,
                parents: [folderId]
            };
            const formData = new FormData();
            formData.append('metadata', new Blob([JSON.stringify(metadata)], {type: 'application/json'}));
            formData.append('file', file);

            const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: new Headers({'Authorization': 'Bearer ' + gapi.client.getToken().access_token}),
                body: formData
            });
            return response.json();
        }

        // --- Customer Approval Flow ---
       // This new version correctly displays all items and costs for the customer.
// This new version correctly displays all items and costs for the customer.
        async function loadApprovalScreen(reportId) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('admin-screens').style.display = 'none';
            document.getElementById('executive-screens').style.display = 'none';
            document.getElementById('customer-approval-screen').classList.add('active-screen');

            // We now only need the 'suggested' column, as it contains the complete list.
            const { data: report, error } = await sb.from('reports')
                .select(`suggested, approved, vehicles ( vehicle_no )`)
                .eq('id', reportId)
                .single();

            if (error || !report) {
                console.error('Error fetching report for approval:', error);
                document.getElementById('approval-content').innerHTML = '<p class="text-center text-red-600">Could not load report details. The link may be invalid.</p>';
                return;
            }

            document.getElementById('approval-vehicle-no').textContent = report.vehicles.vehicle_no;

            if (report.approved && report.approved !== '[]') {
                document.getElementById('approval-content').classList.add('hidden');
                const successMsg = document.getElementById('approval-success-message');
                successMsg.querySelector('h3').textContent = 'Response Already Submitted';
                successMsg.querySelector('p').textContent = 'Thank you, we have already received your feedback for this service request.';
                successMsg.classList.remove('hidden');
                document.querySelector('#customer-approval-card h2').textContent = 'Response Received';
            } else {
                const suggestionsList = document.getElementById('approval-suggestions-list');
                suggestionsList.innerHTML = '';
                try {
                    // This now gets the complete, correct list from the 'suggested' column
                    const allItems = JSON.parse(report.suggested || '[]');

                    if (allItems.length > 0) {
                         allItems.forEach(item => {
                            const isOriginalComplaint = item.type === 'complaint';
                            const label = document.createElement('label');
                            const bgColor = isOriginalComplaint ? 'bg-gray-100' : 'bg-blue-50';
                            const tag = isOriginalComplaint 
                                ? `<span class="text-xs text-gray-500">(Your Request)</span>` 
                                : `<span class="text-xs text-blue-600">(Mechanic Suggestion)</span>`;
                            
                            // CRITICAL FIX: Display amount as text, not an input field.
                            const amountDisplay = `<span class="font-bold text-gray-800 shrink-0">₹${(item.amount || 0).toFixed(2)}</span>`;
                            const checkboxValue = `'${JSON.stringify(item)}'`;

                            label.className = `flex items-center gap-3 p-3 ${bgColor} rounded-lg cursor-pointer hover:bg-gray-200 transition-colors`;
                            
                            // THE FIX IS ON THE NEXT LINE: Added 'break-all' class to the span
                            label.innerHTML = `
                                <input type="checkbox" value=${checkboxValue} class="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" onchange="updateCustomerTotal()">
                                <div class="flex-1 flex justify-between items-center gap-3">
                                     <span class="text-sm font-medium break-words">${item.text}</span>
                                     ${amountDisplay}
                                </div>
                                ${tag}
                            `;
                            suggestionsList.appendChild(label);
                        });
                    } else {
                        suggestionsList.innerHTML = '<p class="text-sm text-gray-500">No specific repairs were suggested.</p>';
                    }
                } catch (e) {
                    console.error("Error parsing items for approval:", e);
                    suggestionsList.innerHTML = '<p class="text-sm text-red-500">Could not display suggested repairs.</p>';
                }
                updateCustomerTotal();
            }
        }


        async function submitCustomerFeedback() {
    const params = new URLSearchParams(window.location.search);
    const reportId = params.get('report_id');
    if (!reportId) {
        return showError("Invalid session. Report ID not found.");
    }

    const approvedItems = [];
    document.querySelectorAll('#approval-suggestions-list input[type="checkbox"]:checked').forEach(checkbox => {
        try {
            approvedItems.push(JSON.parse(checkbox.value));
        } catch {}
    });

    const feedbackText = document.getElementById('customer-feedback-text').value.trim();
    
    const updateData = {
        approved: JSON.stringify(approvedItems),
        customer_feedback_text: feedbackText,
    };

    showSuccessMessage('Submitting your response...');

    if (voiceNoteBlob) {
        try {
            const filePath = `feedback_audio/report_${reportId}_${Date.now()}.webm`;
            const { error: uploadError } = await sb.storage.from('autofix-media').upload(filePath, voiceNoteBlob);
            if (uploadError) throw uploadError;
            const { data: urlData } = sb.storage.from('autofix-media').getPublicUrl(filePath);
            updateData.customer_feedback_audio = urlData.publicUrl;
        } catch (error) {
            console.error('Audio upload error:', error);
            showError('Could not upload your voice note. Please try again.');
            return; 
        }
    }
    
    const { error } = await sb.from('reports').update(updateData).eq('id', reportId);

    if (error) {
        console.error('Error submitting feedback:', error);
        return showError('Failed to submit your response. Please try again.');
    }
    
    document.getElementById('approval-content').classList.add('hidden');
    document.getElementById('approval-success-message').classList.remove('hidden');
}


document.addEventListener('DOMContentLoaded', async () => { // Make this async
            const params = new URLSearchParams(window.location.search);
            const reportId = params.get('report_id');
            const feedbackId = params.get('feedback_id');
            if (reportId) {
                loadApprovalScreen(reportId);
            } else if (feedbackId) {
                loadFeedbackScreen(feedbackId);
            } else {
                const savedUser = sessionStorage.getItem('currentUser');
                if (savedUser) {
                    currentUser = JSON.parse(savedUser);
                    if (currentUser.role === 'admin') {
                        showAdminScreen('admin-dashboard-screen');
                    } else if (currentUser.role === 'executive') {
                        document.getElementById('profile-username').textContent = currentUser.username;
                        document.getElementById('profile-role').textContent = currentUser.role;
                        // ADDED THIS LINE TO FIX THE BUG
                        await fetchAndApplyAppSettings(); 
                        showExecutiveScreen('job-card-screen');
                    } else if (currentUser.role === 'washer') {
                        showScreen('washer-screen');
                        populateWashList();
                    }
                }
            }
            carImage = document.getElementById("carImage");
            damageCanvas = document.getElementById("damageCanvas");
            checkCanvas = document.getElementById("checkCanvas");
            if (carImage && damageCanvas && checkCanvas) {
                damageCtx = damageCanvas.getContext("2d");
                checkCtx = checkCanvas.getContext("2d", { willReadFrequently: true });
                carImage.onload = resizeCanvas;
                window.addEventListener("resize", resizeCanvas);
                damageCanvas.addEventListener("click", (e) => {
                    if (!checkCtx) return;
                    const rect = damageCanvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const pixel = checkCtx.getImageData(x, y, 1, 1).data;
                    const alpha = pixel[3];
                    if (alpha > 0) {
                        damageCtx.fillStyle = "red";
                        damageCtx.beginPath();
                        damageCtx.arc(x, y, 5, 0, Math.PI * 2);
                        damageCtx.fill();
                        damageMarks.push({ x, y });
                    }
                });
            }
        });
		
		
        function printJobCardById(reportId) {
            const reportData = reportsDataStore[reportId];
            if (reportData) {
                printJobCard(reportData);
            } else {
                console.error(`Report data not found for ID: ${reportId}`);
                showError("Could not find report data to print.");
            }
        }

        function printJobCard(reportData) {
            document.getElementById('print-report-date').textContent = new Date(reportData.created_at).toLocaleString();
            document.getElementById('print-executive-name').textContent = reportData.executive?.username || 'N/A';
            document.getElementById('print-vehicle-no').textContent = reportData.vehicles.vehicle_no || 'N/A';
            document.getElementById('print-vehicle-name').textContent = `${reportData.vehicles.vehicle_models.brand} ${reportData.vehicles.vehicle_models.model}`;
            document.getElementById('print-engine-chassis').textContent = `${reportData.vehicles.engine_no || 'N/A'} / ${reportData.vehicles.chassis_no || 'N/A'}`;
			document.getElementById('print-client-name').textContent = reportData.client_name || 'N/A';
			document.getElementById('print-client-phone').textContent = reportData.client_phone || 'N/A';
			document.getElementById('print-odometer').textContent = reportData.odometer_reading || 'N/A';

            
            const populateList = (listId, dataString) => {
                const list = document.getElementById(listId);
                list.innerHTML = '';
                try {
                    const items = JSON.parse(dataString || '[]'); // Safely parse the data
                    if (items && items.length > 0) {
                        items.forEach(item => {
                            const li = document.createElement('li');
                            // **THE FIX: Check if the item is an object and use its .text property**
                            if (typeof item === 'object' && item !== null && item.text) {
                                li.textContent = item.text;
                            } else {
                                // Fallback for older data that might just be strings
                                li.textContent = item;
                            }
                            list.appendChild(li);
                        });
                    } else {
                        list.innerHTML = '<li>N/A</li>';
                    }
                } catch (e) {
                    list.innerHTML = '<li>Error loading data</li>';
                }
            };
            populateList('print-complaints-list', reportData.complaint);
            populateList('print-suggested-list', reportData.suggested);
            populateList('print-approved-list', reportData.approved);

            const printImage = document.getElementById('print-car-image');
            const printCanvas = document.getElementById('print-damage-canvas');
            const marksArray = reportData.marks ? JSON.parse(reportData.marks) : [];

            const drawMarksAndPrint = () => {
                const sourceWidth = 384; 
                const aspectRatio = printImage.naturalWidth / printImage.naturalHeight;
                const sourceHeight = sourceWidth / aspectRatio;

                const destWidth = 400;
                const destHeight = destWidth / aspectRatio;
                
                printCanvas.width = destWidth;
                printCanvas.height = destHeight;

                const widthRatio = destWidth / sourceWidth;
                const heightRatio = destHeight / sourceHeight;

                const scaledMarks = marksArray.map(mark => ({
                    x: mark.x * widthRatio,
                    y: mark.y * heightRatio
                }));

                redrawDamageMarks(printCanvas, scaledMarks);
                window.print();
            };

            if (printImage.complete) {
                drawMarksAndPrint();
            } else {
                printImage.onload = drawMarksAndPrint;
            }
        }

		function downloadReport() {
            const isAdminScreenActive = document.getElementById('admin-screens').classList.contains('active-screen');
            const table = isAdminScreenActive 
                ? document.querySelector('#admin-reports-screen .report-table') 
                : document.querySelector('#report-screen .report-table');

            if (!table) {
                showError('Could not find the report table.');
                return;
            }

            const rows = table.querySelectorAll('tr');
            if (rows.length <= 1) { 
                showError('No data available to download.');
                return;
            }

            let csv = [];
            
            const formatCell = (cellText) => {
                let text = cellText.replace(/"/g, '""');
                if (text.search(/("|,|\n)/g) >= 0) {
                    text = `"${text}"`;
                }
                return text;
            };

            const headers = [];
            rows[0].querySelectorAll('th').forEach(th => {
                headers.push(formatCell(th.textContent.trim()));
            });
            csv.push(headers.join(','));

            for (let i = 1; i < rows.length; i++) {
                const row = [], cols = rows[i].querySelectorAll('td');
                for (let j = 0; j < cols.length; j++) {
                    if (j === 0) { 
                        row.push(formatCell(cols[j].querySelector('span:last-child').textContent.trim()));
                    } else if (cols[j].querySelector('button') || cols[j].querySelector('audio')) {
                         row.push('See in App');
                    } else {
                         row.push(formatCell(cols[j].textContent.trim()));
                    }
                }
                csv.push(row.join(','));
            }

            const csvFile = new Blob([csv.join('\n')], { type: 'text/csv' });
            const downloadLink = document.createElement('a');
            
            const today = new Date().toISOString().slice(0, 10);
            downloadLink.download = `AutoFix_Report_${today}.csv`;
            downloadLink.href = window.URL.createObjectURL(csvFile);
            downloadLink.style.display = 'none';
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            
            showSuccessMessage("Report is downloading...");
        }
    // Make functions available to HTML onclick/onsubmit handlers
window.login = login;
window.logout = logout;
window.searchVehicle = searchVehicle;
window.createVehicle = createVehicle;
window.addComplaint = addComplaint;
window.deleteComplaint = deleteComplaint;
window.saveComplaints = saveComplaints;
window.addSuggestion = addSuggestion;
window.deleteSuggestion = deleteSuggestion;
window.saveVehicleUpdate = saveVehicleUpdate;
window.sendApprovalLink = sendApprovalLink;
window.handleImageUpload = handleImageUpload;
window.handlePhotoUploads = handlePhotoUploads;
window.removePhoto = removePhoto;
window.handleRecordingToggle = handleRecordingToggle;
window.handleCustomerApprovalRecordingToggle = handleCustomerApprovalRecordingToggle;
window.analyzeImageWithAPI = analyzeImageWithAPI;
window.closeScannerModal = closeScannerModal;
window.populateModelDropdown = populateModelDropdown;
window.addVehicleModel = addVehicleModel;
window.addUser = addUser;
window.confirmDeletion = confirmDeletion;
window.resetPassword = resetPassword;
window.showAdminScreen = showAdminScreen;
window.showExecutiveScreen = showExecutiveScreen;
window.applyReportFilters = applyReportFilters;
window.clearReportFilters = clearReportFilters;
window.applyAdminReportFilters = applyAdminReportFilters;
window.clearAdminReportFilters = clearAdminReportFilters;
window.renderAnalytics = renderAnalytics;
window.downloadReport = downloadReport;
window.handleAuthClick = handleAuthClick;
window.handleSignoutClick = handleSignoutClick;
window.submitCustomerFeedback = submitCustomerFeedback;
window.submitCustomerTextFeedback = submitCustomerTextFeedback;
window.showUpdateTab = showUpdateTab;
window.selectReportForUpdateById = selectReportForUpdateById;
window.openMarksModal = openMarksModal;
window.closeMarksModal = closeMarksModal;
window.printJobCardById = printJobCardById;
window.showCloseTab = showCloseTab;
window.updateJobStatus = updateJobStatus;
window.openCancelModal = openCancelModal;
window.closeCancelModal = closeCancelModal;
window.cancelCompletion = cancelCompletion;
window.handleDateChange = handleDateChange;
window.undoLastMark = undoLastMark;
window.clearDamageCanvas = clearDamageCanvas;
window.updateSetting = updateSetting;
window.updateReportColumns = updateReportColumns;
window.filterSettings = filterSettings;
window.showQuickAccessModal = showQuickAccessModal;
window.hideModal = hideModal;
window.completeWash = completeWash;
window.handleInspection = handleInspection;
window.showInspectionDetails = showInspectionDetails;
window.resendForInspection = resendForInspection;
window.handleDuplicateConfirmation = handleDuplicateConfirmation;
window.markCompletedDirectly = markCompletedDirectly;
window.handleCheckboxChange = handleCheckboxChange;
window.updateComplaintCost = updateComplaintCost;
window.addMaterialField = addMaterialField;
window.removeMaterialField = removeMaterialField;
window.updateMaterialsFromInputs = updateMaterialsFromInputs;
window.executeAddSuggestion = executeAddSuggestion;
window.updateCustomerTotal = updateCustomerTotal;
window.checkOdometer = checkOdometer;
window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;
} // Closes initApp
})(); // Closes wrapper