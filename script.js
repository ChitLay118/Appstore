import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, addDoc, serverTimestamp, doc, getDoc, setDoc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// setLogLevel('Debug'); // Debugging အတွက်

// 1. Global Variables Setup
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');

// --- ADMIN CONSTANTS (Encoded to hide from casual viewing) ---
window.isAdmin = false;
// User: felix (Base64)
const ENCODED_USERNAME = 'ZmVsaXg='; 
// Pass: 118234 (Base64)
const ENCODED_PASSWORD = 'MTE4MjM0';
 
// Decode the secret values for use in comparison
const ADMIN_USERNAME = atob(ENCODED_USERNAME); 
const ADMIN_PASSWORD = atob(ENCODED_PASSWORD); 
 
let currentEditAppId = null; // App ID for the app currently being edited
// -----------------------

// 2. Firebase Initialization
const app = initializeApp(firebaseConfig);
window.db = getFirestore(app);
window.auth = getAuth(app);
window.allApps = []; 
window.userProfile = { name: null, email: null }; 
 
let userId = null;
let currentView = 'all'; 
let currentCategory = 'All'; 
let isAuthReady = false;
 
const APP_COLLECTION_PATH = `artifacts/${appId}/public/data/apps`;
 
// UI Elements
const appListContainer = document.getElementById('appListContainer');
const userDisplayBtn = document.getElementById('userDisplayBtn');
const loadingIndicator = document.getElementById('loadingIndicator');
const noResults = document.getElementById('noResults');
const viewTitle = document.getElementById('viewTitle');
const backToAllContainer = document.getElementById('backToAllContainer'); 
const submitAppModal = document.getElementById('submitAppModal');
const appSubmissionForm = document.getElementById('appSubmissionForm');
const profileModal = document.getElementById('profileModal');
const editAppModal = document.getElementById('editAppModal'); // New Edit Modal
const editAppForm = document.getElementById('editAppForm'); // New Edit Form

// --- FIREBASE FUNCTIONS ---
 
// 3. Authentication Setup (Sign In)
onAuthStateChanged(auth, async (user) => {
    if (user) {
        userId = user.uid;
    } else {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            try {
                await signInWithCustomToken(auth, __initial_auth_token);
                userId = auth.currentUser.uid;
            } catch (error) {
                console.error("Custom token sign-in failed:", error);
                await signInAnonymously(auth);
                userId = auth.currentUser.uid;
            }
        } else {
            await signInAnonymously(auth);
            userId = auth.currentUser.uid;
        }
    }
    
    isAuthReady = true;
    await fetchUserProfile(); 
    setupRealtimeListener();
});

// 4. User Profile Management
const getProfileDocRef = () => doc(db, `artifacts/${appId}/users/${userId}/profile/details`);

async function fetchUserProfile() {
    if (!userId) return;
    const profileRef = getProfileDocRef();
    try {
        const docSnap = await getDoc(profileRef);
        if (docSnap.exists()) {
            window.userProfile = docSnap.data();
        } else {
            // Default profile creation if not exists
            window.userProfile = { 
                name: `User_${userId.substring(0, 6)}`, 
                email: `anonymous_${userId.substring(0, 4)}@temp.com` 
            };
            await setDoc(profileRef, window.userProfile); // Create default profile
        }
        window.updateProfileUI();
        // Update the profile ID display in the modal once it's available
        document.getElementById('currentUserIdSpan').textContent = userId; 
    } catch (error) {
        console.error("Error fetching/creating user profile:", error);
    }
}
 
window.updateProfileUI = function() {
    // Get initials from name, default to 'U'
    const initials = (window.userProfile.name || 'U').substring(0, 2);
    
    // Update Top Right Avatar Button
    userDisplayBtn.textContent = initials.toUpperCase();
    userDisplayBtn.title = `Profile: ${window.userProfile.name || 'Unknown User'}`;
    
    // Update Profile Modal fields (Input fields for editing)
    document.getElementById('profileNameInput').value = window.userProfile.name || '';
    document.getElementById('profileEmailInput').value = window.userProfile.email || '';
    
    // Update profile info within the modal (Display area)
    document.getElementById('profileAvatarInitials').textContent = initials.toUpperCase(); // Ensure initials are shown in modal avatar
    document.getElementById('profileDisplayName').textContent = window.userProfile.name || 'Unknown User';
    document.getElementById('profileDisplayEmail').textContent = window.userProfile.email || 'No Email Provided';

    // Also update submit form pre-fills if modal is open
    const submitterNameInput = document.getElementById('submitterNameInput');
    const submitterEmailInput = document.getElementById('submitterEmailInput');
    if (submitterNameInput) submitterNameInput.value = window.userProfile.name || '';
    if (submitterEmailInput) submitterEmailInput.value = window.userProfile.email || '';
    
    // Update Admin Status UI
    const adminStatus = document.getElementById('adminPanelStatus');
    const adminLogin = document.getElementById('adminLoginContainer');
    if (adminStatus && adminLogin) {
        if (window.isAdmin) {
            adminStatus.classList.remove('hidden');
            adminLogin.classList.add('hidden');
        } else {
            adminStatus.classList.add('hidden');
            adminLogin.classList.remove('hidden');
        }
    }
}
 
// Save Profile Logic
document.getElementById('profileSaveBtn').addEventListener('click', async () => {
    const name = document.getElementById('profileNameInput').value.trim();
    const email = document.getElementById('profileEmailInput').value.trim();

    if (!name) {
        window.showToast("နာမည် ထည့်သွင်းပေးပါ။", 'error');
        return;
    }
    
    const profileRef = getProfileDocRef();
    try {
        await setDoc(profileRef, { name, email }, { merge: true });
        window.userProfile = { name, email };
        window.updateProfileUI();
        profileModal.classList.add('hidden');
        window.showToast("Profile အချက်အလက်များကို သိမ်းဆည်းပြီးပါပြီ။", 'success');
    } catch (error) {
        console.error("Error saving profile:", error);
        window.showToast("Profile သိမ်းဆည်းရာတွင် အမှားဖြစ်ခဲ့သည်။", 'error');
    }
});


// 5. Real-time App Listener
function setupRealtimeListener() {
    if (!isAuthReady) return;

    const q = collection(db, APP_COLLECTION_PATH);
    
    onSnapshot(q, (snapshot) => {
        const fetchedApps = [];
        snapshot.forEach((doc) => {
            fetchedApps.push({ id: doc.id, ...doc.data() });
        });
        
        fetchedApps.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
        
        window.allApps = fetchedApps;
        loadingIndicator.classList.add('hidden');
        window.filterApps(); 
    }, (error) => {
        console.error("Error fetching apps: ", error);
        loadingIndicator.innerHTML = `<p class="text-red-500">App များဆွဲယူရာတွင် အမှားဖြစ်ခဲ့သည်။</p>`;
    });
}
 
// 6. App Submission Logic (Remains the same)
appSubmissionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('appName').value.trim();
    const description = document.getElementById('appDescription').value.trim();
    const category = document.getElementById('appCategory').value;
    const mediaFireLink = document.getElementById('mediaFireLink').value.trim(); 
    const iconUrl = document.getElementById('iconUrl').value.trim();

    if (!name || !description || !mediaFireLink || !iconUrl) {
        window.showToast("ကျေးဇူးပြု၍ လိုအပ်သောအချက်အလက်အားလုံးကို ဖြည့်သွင်းပါ။", 'error');
        return;
    }
    
    const validDomains = ['drive.google.com', 'mediafire.com', 'mega.nz'];
    const isLinkValid = validDomains.some(domain => mediaFireLink.toLowerCase().includes(domain));

    if (!isLinkValid) {
        window.showToast("ကျေးဇူးပြု၍ Google Drive, MediaFire သို့မဟုတ် Mega မှ မှန်ကန်သော ဒေါင်းလုတ်လင့်ခ်ကို ထည့်သွင်းပါ။", 'error');
        return;
    }
    
    const submitterName = window.userProfile.name || `User_${userId.substring(0, 6)}`;
    const submitterEmail = window.userProfile.email || 'No Email';

    try {
        await addDoc(collection(db, APP_COLLECTION_PATH), {
            name,
            description,
            category,
            mediaFireLink,
            iconUrl,
            submittedBy: userId,
            submitterName: submitterName, 
            submitterEmail: submitterEmail, 
            createdAt: serverTimestamp()
        });

        window.showToast("App တင်သွင်းမှု အောင်မြင်ပါသည်!", 'success');
        appSubmissionForm.reset();
        submitAppModal.classList.add('hidden');
    } catch (error) {
        console.error("Error adding document: ", error);
        window.showToast("App တင်သွင်းရာတွင် အမှားဖြစ်ခဲ့သည်။", 'error');
    }
});

// 7. View & Category Filtering (Remains the same)
window.setView = function(view) {
    currentView = view;
    window.setCategoryFilter('All', false); 
    const newTitle = view === 'all' ? "အသစ်ဆုံး App များအားလုံး" : "ကျွန်ုပ်တင်ထားသော App များ";
    viewTitle.textContent = newTitle;
    
    if (view === 'mine') {
        backToAllContainer.innerHTML = `
            <button onclick="window.setView('all')" 
                    class="flex items-center text-sm font-semibold text-active-blue hover:text-blue-700 transition duration-150 py-1.5 px-3 rounded-full bg-blue-100 hover:bg-blue-200 shadow-md">
                <i data-lucide="arrow-left" class="w-4 h-4 mr-1"></i>
                App အားလုံး ပြန်ကြည့်ရန်
            </button>
        `;
    } else {
        backToAllContainer.innerHTML = '';
    }
    
    lucide.createIcons(); 
    profileModal.classList.add('hidden');
    window.filterApps();
}
 
window.setCategoryFilter = function(category, shouldFilter = true) {
    currentCategory = category;
    
    document.querySelectorAll('.nav-category-btn').forEach(btn => {
        btn.classList.remove('text-active-blue', 'font-bold', 'scale-110');
        btn.classList.add('text-gray-500');
    });
    
    const activeCategoryBtn = document.getElementById(`nav-${category}`);
    if (activeCategoryBtn) {
        activeCategoryBtn.classList.remove('text-gray-500'); 
        activeCategoryBtn.classList.add('text-active-blue', 'font-bold', 'scale-110');
    }

    if (shouldFilter) window.filterApps();
}

window.filterApps = function() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();

    let filteredApps = window.allApps.filter(app => {
        const matchesSearch = app.name.toLowerCase().includes(searchTerm) ||
                              app.description.toLowerCase().includes(searchTerm);
        const matchesCategory = currentCategory === 'All' || app.category === currentCategory;

        return matchesSearch && matchesCategory;
    });
    
    if (currentView === 'mine') {
        filteredApps = filteredApps.filter(app => app.submittedBy === userId);
    }

    renderApps(filteredApps);
}
 
// 8. App Rendering Function (Updated to include Admin Controls)
function renderApps(apps) {
    const appListContainer = document.getElementById('appListContainer');
    const noResults = document.getElementById('noResults');

    appListContainer.innerHTML = '';
    
    if (apps.length === 0) {
        noResults.classList.add('hidden');
        
        // Show 'No Results' only if there are no apps after filtering
        const isSearching = document.getElementById('searchInput').value.trim() !== '';
        const isFiltered = currentCategory !== 'All';

        if (window.allApps.length > 0 || isSearching || isFiltered || currentView === 'mine') {
            noResults.classList.remove('hidden');
            document.getElementById('noResultsText').textContent = 'ရှာဖွေမှုရလဒ် မတွေ့ရှိပါ။';
        } else {
            noResults.classList.remove('hidden');
            document.getElementById('noResultsText').textContent = 'လောလောဆယ် App များ မရှိသေးပါ။';
        }

    } else {
        noResults.classList.add('hidden');
        apps.forEach(app => {
            appListContainer.innerHTML += createAppCard(app); 
        });
    }
    lucide.createIcons(); 
}

function categoryToBurmese(category) {
    switch (category) {
        case 'Games': return 'ဂိမ်း';
        case 'Utility': return 'အသုံးဝင်မှု';
        case 'Social': return 'လူမှုရေး';
        case 'Entertainment': return 'ဖျော်ဖြေရေး'; 
        default: return 'App အားလုံး';
    }
}

function createAppCard(app) {
    const defaultIcon = 'https://placehold.co/128x128/94a3b8/ffffff?text=App';
    const icon = app.iconUrl && app.iconUrl.startsWith('http') ? app.iconUrl : defaultIcon;
    
    const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download mr-1"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
    
    const submitterInfo = app.submitterName || (app.submittedBy ? `User ID: ${app.submittedBy.substring(0, 8)}...` : 'Unknown');
    const submitterEmail = app.submitterEmail || '';

    // --- ADMIN CONTROLS ---
    let adminControls = '';
    // Only show Admin buttons if isAdmin is true
    if (window.isAdmin) {
        adminControls = `
            <div class="flex space-x-2 mb-3">
                <button onclick="window.openEditModal('${app.id}')" 
                        class="flex-1 flex items-center justify-center py-2 text-sm rounded-full bg-yellow-600 text-white font-semibold hover:bg-yellow-700 transition duration-150 shadow-md">
                    <i data-lucide="pencil" class="w-4 h-4 mr-1"></i>
                    ပြင်ရန်
                </button>
            </div>
        `;
    }
    // -----------------------


    return `
        <div class="bg-white p-4 rounded-xl shadow-play flex flex-col transform transition duration-200 hover:shadow-card-hover hover:scale-[1.03] border-t-4 border-t-play-green/80">
            <div class="flex flex-col items-center text-center mb-3">
                <img src="${icon}" alt="${app.name} icon" class="w-20 h-20 rounded-2xl object-cover shadow-lg border-2 border-gray-100 mb-2" onerror="this.onerror=null;this.src='${defaultIcon}'">
                <h3 class="text-lg font-bold text-gray-800 truncate w-full" title="${app.name}">${app.name}</h3>
                <span class="text-xs text-play-green bg-green-100 px-2 py-0.5 rounded-full inline-block mt-1">${categoryToBurmese(app.category)}</span>
            </div>
            
            <p class="text-gray-600 mb-4 flex-grow text-sm text-center line-clamp-3">${app.description}</p>
            
            <div class="text-[10px] text-gray-500 mb-3 text-center">
                <p class="font-bold text-sm text-gray-700 truncate" title="တင်သွင်းသူ: ${submitterInfo}">${submitterInfo}</p>
                ${submitterEmail ? `<p class="text-gray-400 truncate" title="Email: ${submitterEmail}">${submitterEmail}</p>` : ''}
            </div>

            ${adminControls} 
            
            <a href="${app.mediaFireLink}" target="_blank"
               class="mt-auto flex items-center justify-center w-full text-center py-2.5 px-4 rounded-full bg-active-blue text-white font-semibold hover:bg-active-blue-dark active:bg-blue-700 transition duration-150 shadow-md">
                ${downloadIcon}
                ဒေါင်းလုတ်ဆွဲရန်
            </a>
        </div>
    `;
}
 
// --- NEW ADMIN FUNCTIONS ---
// Admin constants (ADMIN_USERNAME, ADMIN_PASSWORD) are set up above via decoding.

window.attemptAdminLogin = function() {
    const adminUsernameInput = document.getElementById('adminUsernameInput').value.trim();
    const adminPasswordInput = document.getElementById('adminPasswordInput').value.trim();

    if (adminUsernameInput === ADMIN_USERNAME && adminPasswordInput === ADMIN_PASSWORD) {
        window.isAdmin = true;
        window.showToast("Admin အဖြစ် ဝင်ရောက်မှု အောင်မြင်ပါသည်။", 'success');
        document.getElementById('adminLoginContainer').classList.add('hidden');
        document.getElementById('adminPanelStatus').classList.remove('hidden');
        profileModal.classList.add('hidden');
        window.filterApps(); // Refresh view to show controls
    } else {
        window.showToast("နာမည် သို့မဟုတ် လျှို့ဝှက်နံပါတ် မှားယွင်းနေပါသည်။", 'error');
        window.isAdmin = false;
    }
}

window.logoutAdmin = function() {
    window.isAdmin = false;
    document.getElementById('adminUsernameInput').value = '';
    document.getElementById('adminPasswordInput').value = '';
    window.showToast("Admin အဖြစ်မှ ထွက်လိုက်ပါပြီ။", 'info');
    window.updateProfileUI(); // Reset UI state
    window.filterApps(); // Refresh view to hide controls
}

window.openEditModal = function(appId) {
    if (!window.isAdmin) return window.showToast("Admin အခွင့်အရေး မရှိပါ။", 'error');
    
    const appToEdit = window.allApps.find(app => app.id === appId);
    if (!appToEdit) {
        return window.showToast("App ကို ရှာမတွေ့ပါ။", 'error');
    }

    currentEditAppId = appId;
    
    // Populate the edit modal fields
    document.getElementById('editAppName').value = appToEdit.name || '';
    document.getElementById('editAppDescription').value = appToEdit.description || '';
    document.getElementById('editAppCategory').value = appToEdit.category || 'Utility';
    document.getElementById('editMediaFireLink').value = appToEdit.mediaFireLink || '';
    document.getElementById('editIconUrl').value = appToEdit.iconUrl || '';
    
    // Set App name for delete confirmation area
    document.getElementById('deleteAppNameToConfirm').textContent = appToEdit.name;
    document.getElementById('deleteConfirmationInput').value = ''; // Clear confirmation input

    document.getElementById('editAppModal').classList.remove('hidden');
}

// Admin: Update App Logic
editAppForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEditAppId || !window.isAdmin) return;

    const name = document.getElementById('editAppName').value.trim();
    const description = document.getElementById('editAppDescription').value.trim();
    const category = document.getElementById('editAppCategory').value;
    const mediaFireLink = document.getElementById('editMediaFireLink').value.trim();
    const iconUrl = document.getElementById('editIconUrl').value.trim();
    
    if (!name || !description || !mediaFireLink || !iconUrl) {
        window.showToast("ကျေးဇူးပြု၍ လိုအပ်သောအချက်အလက်အားလုံးကို ဖြည့်သွင်းပါ။", 'error');
        return;
    }
    
    const validDomains = ['drive.google.com', 'mediafire.com', 'mega.nz'];
    const isLinkValid = validDomains.some(domain => mediaFireLink.toLowerCase().includes(domain));
    if (!isLinkValid) {
        window.showToast("မှန်ကန်သော ဒေါင်းလုတ်လင့်ခ်ကို ထည့်သွင်းပါ။", 'error');
        return;
    }
    
    const appRef = doc(window.db, APP_COLLECTION_PATH, currentEditAppId);
    try {
        await updateDoc(appRef, {
            name,
            description,
            category,
            mediaFireLink,
            iconUrl,
        });

        window.showToast(`"${name}" App အချက်အလက်များကို ပြင်ဆင်ပြီးပါပြီ။`, 'success');
        document.getElementById('editAppModal').classList.add('hidden');
        currentEditAppId = null;
    } catch (error) {
        console.error("Error updating app: ", error);
        window.showToast("App ပြင်ဆင်ရာတွင် အမှားဖြစ်ခဲ့သည်။", 'error');
    }
});
 
// Admin: Delete App Confirmation Logic
window.confirmAndDelete = async function() {
    const appNameInput = document.getElementById('deleteConfirmationInput').value.trim();
    if (!currentEditAppId || !window.isAdmin) return;

    const appToEdit = window.allApps.find(app => app.id === currentEditAppId);
    
    if (appNameInput === appToEdit.name) {
        const appRef = doc(window.db, APP_COLLECTION_PATH, currentEditAppId);
        try {
            await deleteDoc(appRef);
            window.showToast(`"${appToEdit.name}" App ဖျက်ခြင်း အောင်မြင်ပါသည်။`, 'success');
            document.getElementById('editAppModal').classList.add('hidden');
            currentEditAppId = null;
        } catch (error) {
            console.error("Error deleting app: ", error);
            window.showToast("App ဖျက်ရာတွင် အမှားဖြစ်ခဲ့သည်။", 'error');
        }
    } else {
        window.showToast("App နာမည် မှန်ကန်စွာ ရိုက်ထည့်ပေးပါ။", 'error');
    }
}
 
// --- END NEW ADMIN FUNCTIONS ---


// Modal Toggling (Added editAppModal close)
document.getElementById('submitAppBtn').addEventListener('click', () => {
    window.updateProfileUI(); 
    submitAppModal.classList.remove('hidden');
});

document.getElementById('closeModalBtn').addEventListener('click', () => {
    submitAppModal.classList.add('hidden');
});
document.getElementById('closeProfileModalBtn').addEventListener('click', () => {
    profileModal.classList.add('hidden');
});
document.getElementById('closeEditModalBtn').addEventListener('click', () => {
    editAppModal.classList.add('hidden');
    currentEditAppId = null;
});

// Outside click to close
submitAppModal.addEventListener('click', (e) => {
    if (e.target === submitAppModal) submitAppModal.classList.add('hidden');
});
profileModal.addEventListener('click', (e) => {
    if (e.target === profileModal) profileModal.classList.add('hidden');
});
editAppModal.addEventListener('click', (e) => {
    if (e.target === editAppModal) {
        editAppModal.classList.add('hidden');
        currentEditAppId = null;
    }
});

// Open Profile Modal (Profile Button Action)
userDisplayBtn.addEventListener('click', () => {
    window.updateProfileUI(); // Ensure latest data is in modal fields and Admin status is current
    profileModal.classList.remove('hidden');
});


// Toast Notification (Custom alert replacement - Same as before)
window.showToast = function(message, type = 'info') {
    const toast = document.getElementById('toastNotification');
    toast.textContent = message;
    toast.className = 'fixed bottom-4 right-4 p-4 rounded-lg shadow-xl text-white transition-opacity duration-300 z-50';

    if (type === 'success') {
        toast.classList.add('bg-green-600');
    } else if (type === 'error') {
        toast.classList.add('bg-red-600');
    } else {
        toast.classList.add('bg-blue-600');
    }

    toast.classList.remove('opacity-0', 'hidden');
    toast.classList.add('opacity-100');

    setTimeout(() => {
        toast.classList.remove('opacity-100');
        toast.classList.add('opacity-0');
    }, 3000);
}

// Initial setup on window load
window.onload = () => {
    lucide.createIcons(); 
    window.setView('all'); 
    window.setCategoryFilter('All', false); 
    document.getElementById('searchInput').oninput = window.filterApps;
};
