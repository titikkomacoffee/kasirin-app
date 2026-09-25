// ==========================================
// 1. INISIALISASI SUPABASE (SESI PERMANEN)
// ==========================================
const SUPABASE_URL = "https://ankprmkhsqkgugzndlcx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFua3BybWtoc3FrZ3Vnem5kbGN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNzI2NzgsImV4cCI6MjEwNTg0ODY3OH0.D48Jxrv2f51Ggl9yT5Tayme5eDAC_Eo1jpM_pmGfp-E";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let currentUser = null;
let currentProfile = null;
let storeSettings = {
  store_name: 'TEMAN COFFEE KUPANG',
  store_address: 'Kupang, NTT',
  store_phone: '081234567890',
  logo_url: '',
  pakasir_slug: 'temancoffee',
  pakasir_api_key: ''
};
let cart = [];
let selectedPaymentMethod = 'CASH';

// ==========================================
// 2. TOAST NOTIFICATION
// ==========================================
function showNotif(message, type = 'success') {
  Toastify({
    text: message,
    duration: 3500,
    gravity: "top",
    position: "center",
    stopOnFocus: true,
    style: {
      background: type === 'success' 
        ? "linear-gradient(to right, #10B981, #059669)" 
        : "linear-gradient(to right, #EF4444, #DC2626)",
      borderRadius: "16px",
      fontSize: "12px",
      fontWeight: "bold"
    }
  }).showToast();
}

// ==========================================
// 3. INIT & PERMANENT STORE DATA LOAD
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  await checkUserSession();
  await loadStoreSettingsFromSupabase(); // Muat data toko permanen
});

async function checkUserSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    currentUser = session.user;
    
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    currentProfile = profile || { role: 'kasir', full_name: currentUser.email };
    document.getElementById('userStatusHeader').innerText = `${currentProfile.role.toUpperCase()}: ${currentProfile.full_name || currentUser.email}`;

    if (currentProfile.role === 'admin') {
      document.getElementById('sectionStoreMgmt').classList.remove('hidden');
    }
  }
}

// MUAT DATA TOKO LENGKAP DARI SUPABASE (PERMANEN MELEWATI REFRESH)
async function loadStoreSettingsFromSupabase() {
  const { data, error } = await supabaseClient
    .from('store_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (data) {
    storeSettings = data;
    
    // Tampilkan di Header & Form Pengaturan
    document.getElementById('storeNameHeader').innerText = data.store_name || 'TEMAN COFFEE POS';
    
    if (data.logo_url) {
      const logoHeader = document.getElementById('storeLogoHeader');
      logoHeader.src = data.logo_url;
      logoHeader.classList.remove('hidden');
    }

    document.getElementById('storeNameInput').value = data.store_name || '';
    document.getElementById('storeAddressInput').value = data.store_address || '';
    document.getElementById('storePhoneInput').value = data.store_phone || '';
    document.getElementById('storeLogoUrlInput').value = data.logo_url || '';
    document.getElementById('pakasirSlugInput').value = data.pakasir_slug || '';
    document.getElementById('pakasirApiKeyInput').value = data.pakasir_api_key || '';
  }
}

// SIMPAN DATA TOKO & CREDENTIALS PAKASIR KE SUPABASE
async function saveStoreSettingsToSupabase() {
  const storeName = document.getElementById('storeNameInput').value;
  const storeAddress = document.getElementById('storeAddressInput').value;
  const storePhone = document.getElementById('storePhoneInput').value;
  const logoUrl = document.getElementById('storeLogoUrlInput').value;
  const slug = document.getElementById('pakasirSlugInput').value;
  const apiKey = document.getElementById('pakasirApiKeyInput').value;

  const { error } = await supabaseClient.from('store_settings').upsert({
    id: 1,
    store_name: storeName,
    store_address: storeAddress,
    store_phone: storePhone,
    logo_url: logoUrl,
    pakasir_slug: slug,
    pakasir_api_key: apiKey,
    updated_at: new Date()
  });

  if (!error) {
    showNotif("Data Toko & Pakasir Berhasil Disimpan di Supabase!");
    await loadStoreSettingsFromSupabase(); // Reload tampilan
  } else {
    showNotif("Gagal menyimpan data toko: " + error.message, "error");
  }
}

// ==========================================
// 4. GENERATE DYNAMIC PAKASIR QRIS
// ==========================================
function selectPaymentMethod(method) {
  selectedPaymentMethod = method;
  const btnCash = document.getElementById('btnPayCash');
  const btnQris = document.getElementById('btnPayQris');
  const qrisArea = document.getElementById('qrisDisplayArea');

  if (method === 'PAKASIR_QRIS') {
    btnQris.className = "p-3 border-2 border-purple-600 rounded-2xl bg-purple-50 text-purple-700 font-bold text-xs flex flex-col items-center gap-1";
    btnCash.className = "p-3 border-2 border-gray-200 rounded-2xl bg-gray-50 text-gray-600 font-bold text-xs flex flex-col items-center gap-1";
    
    // Ambil Slug Pakasir yang tersimpan dari Supabase (bukan dari input lokal)
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const slug = storeSettings.pakasir_slug || 'temancoffee';
    const orderId = `INV-${Date.now()}`;
    
    // URL Dynamic Pakasir Generator
    const pakasirUrl = `https://pakasir.com/api/qris?project=${slug}&amount=${totalAmount}&order_id=${orderId}`;
    document.getElementById('qrisImage').src = pakasirUrl;
    qrisArea.classList.remove('hidden');
  } else {
    btnCash.className = "p-3 border-2 border-purple-600 rounded-2xl bg-purple-50 text-purple-700 font-bold text-xs flex flex-col items-center gap-1";
    btnQris.className = "p-3 border-2 border-gray-200 rounded-2xl bg-gray-50 text-gray-600 font-bold text-xs flex flex-col items-center gap-1";
    qrisArea.classList.add('hidden');
  }
}

function openPaymentModal() {
  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  if (total <= 0) return showNotif("Keranjang belanja masih kosong!", "error");

  document.getElementById('payModalTotalText').innerText = `Rp ${total.toLocaleString('id-ID')}`;
  document.getElementById('paymentModal').classList.remove('hidden');
  selectPaymentMethod('CASH');
}

function closePaymentModal() { document.getElementById('paymentModal').classList.add('hidden'); }

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
  document.getElementById(`tab${tabName}`).classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(n => n.className = "nav-item text-gray-400 flex flex-col items-center gap-1");
  const activeNav = document.getElementById(`nav${tabName}`);
  if (activeNav) activeNav.className = "nav-item text-purple-600 flex flex-col items-center gap-1";
}

async function handleUserLogout() {
  await supabaseClient.auth.signOut();
  showNotif("Berhasil keluar akun");
  window.location.reload();
      }
