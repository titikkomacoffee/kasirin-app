// ============================================================
// 1. KONFIGURASI
// ============================================================
const SUPABASE_URL = 'https://pxvvdowqiesbhngumktn.supabase.co';    // ← GANTI
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4dnZkb3dxaWVzYmhuZ3Vta3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNzAwNTIsImV4cCI6MjEwNTc0NjA1Mn0.fTwhIhy09d8qkIUWY0RHVbJxz0mue1z5AmOR8ncfMMc';           // ← GANTI

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentProfile = null;
let products = [];
let cart = [];
let categories = [];
let activeCategory = 'all';
let reportRange = 'today';

// ============================================================
// 2. AUTH
// ============================================================
async function doLogin() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const msg = document.getElementById('loginMsg');
  msg.style.color = 'var(--text-dim)';
  msg.textContent = 'Memproses...';

  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) { msg.style.color = 'var(--red)'; msg.textContent = '❌ ' + error.message; return; }

  currentUser = data.user;
  await loadProfile();
  showApp();
}

async function doRegister() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const msg = document.getElementById('loginMsg');

  if (!email || !password) {
    msg.style.color = 'var(--red)';
    msg.textContent = '❌ Email dan password wajib diisi';
    return;
  }

  const { data, error } = await db.auth.signUp({ email, password });
  if (error) { msg.style.color = 'var(--red)'; msg.textContent = '❌ ' + error.message; return; }

  if (data.user) {
    await db.from('profiles').insert({
      id: data.user.id,
      full_name: email.split('@')[0],
      role: 'admin',
      is_active: true
    });
  }
  msg.style.color = 'var(--green)';
  msg.textContent = '✅ Akun dibuat! Silakan klik Masuk.';
}

async function doLogout() {
  await db.auth.signOut();
  location.reload();
}

async function loadProfile() {
  const { data } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = data || { role: 'kasir', full_name: currentUser.email };
}

function showApp() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('appPage').classList.remove('hidden');
  const initial = (currentProfile.full_name || 'K').charAt(0).toUpperCase();
  document.getElementById('headerAvatar').textContent = initial;
  document.getElementById('modalAvatar').textContent = initial;
  document.getElementById('userInfo').textContent = currentProfile.full_name || '-';
  document.getElementById('userRole').textContent = currentProfile.role || '-';
  document.getElementById('headerOutlet').textContent = currentProfile.full_name || 'Usaha Saya';

  // Tanggal header
  const now = new Date();
  const opts = { weekday: 'long', day: 'numeric', month: 'short' };
  document.getElementById('headerDate').textContent = now.toLocaleDateString('id-ID', opts);

  // Greeting
  const hour = now.getHours();
  const greet = hour < 11 ? 'Selamat Pagi!' : hour < 15 ? 'Selamat Siang!' : hour < 19 ? 'Selamat Sore!' : 'Selamat Malam!';
  document.getElementById('headerGreeting').textContent = greet + ' 👋';

  initApp();
}

// Auto-login
(async () => {
  const { data } = await db.auth.getSession();
  if (data.session) {
    currentUser = data.session.user;
    await loadProfile();
    showApp();
  }
})();

// ============================================================
// 3. NAVIGASI
// ============================================================
function goTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.add('active');

  // Update bottom nav
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });

  // Scroll top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Load data halaman
  if (page === 'dashboard') loadDashboard();
  if (page === 'produk') loadProductsTable();
  if (page === 'laporan') loadReport();
  if (page === 'piutang') loadReceivables();
  if (page === 'shift') loadShift();
  if (page === 'absensi') loadAttendance();
  if (page === 'riwayat') loadTransactions();
  if (page === 'pos') { renderProducts(); updateFab(); }
}

// ============================================================
// 4. TEMA
// ============================================================
function changeTheme(theme) {
  document.body.className = theme === 'light' ? '' : 'theme-' + theme;
  localStorage.setItem('kasir-theme', theme);
}
const savedTheme = localStorage.getItem('kasir-theme') || 'light';
document.getElementById('themeSelect').value = savedTheme;
changeTheme(savedTheme);

// ============================================================
// 5. INIT
// ============================================================
async function initApp() {
  await loadCategories();
  await loadProducts();
  renderProducts();
  loadDashboard();
  updateFab();
}

async function loadCategories() {
  const { data } = await db.from('products').select('category');
  const set = new Set((data || []).map(p => p.category).filter(Boolean));
  categories = [...set];
  const html = `<button class="active" onclick="filterCategory('all', this)">Semua</button>` +
    categories.map(c => `<button onclick="filterCategory('${c}', this)">${c}</button>`).join('');
  document.getElementById('categoryList').innerHTML = html;
}

function filterCategory(cat, btn) {
  activeCategory = cat;
  document.querySelectorAll('.cat-chips button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProducts();
}

async function loadProducts() {
  const { data } = await db.from('products').select('*').eq('is_active', true).order('name');
  products = data || [];
}

// ============================================================
// 6. PRODUK (Grid POS)
// ============================================================
function renderProducts() {
  const search = (document.getElementById('searchProduct')?.value || '').toLowerCase();
  const filtered = products.filter(p =>
    (activeCategory === 'all' || p.category === activeCategory) &&
    (!search || p.name.toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search))
  );

  document.getElementById('productGrid').innerHTML = filtered.map(p => `
    <div class="product-card" onclick="addToCart('${p.id}')">
      <div class="img-wrap">
        ${p.image_url ? `<img src="${p.image_url}" alt="">` : '🍽️'}
      </div>
      <div class="info">
        <div class="name">${p.name}</div>
        <div class="price">Rp ${formatNumber(p.price)}</div>
        <div class="stock">Stok: ${p.stock}</div>
      </div>
    </div>
  `).join('') || '<p style="grid-column:1/-1;text-align:center;color:var(--text-dim);padding:40px;">Belum ada produk</p>';
}

function formatNumber(n) { return new Intl.NumberFormat('id-ID').format(n || 0); }

// ============================================================
// 7. CART
// ============================================================
function addToCart(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  const existing = cart.find(x => x.id === productId);
  if (existing) {
    if (existing.qty >= p.stock) return alert('Stok tidak cukup');
    existing.qty++;
  } else {
    if (p.stock < 1) return alert('Stok habis');
    cart.push({ id: p.id, name: p.name, price: p.price, qty: 1 });
  }
  renderCart();
  updateFab();
}

function changeQty(id, delta) {
  const item = cart.find(x => x.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(x => x.id !== id);
  renderCart();
  updateFab();
}

function renderCart() {
  const container = document.getElementById('cartItems');
  if (!container) return;
  if (cart.length === 0) {
    container.innerHTML = '<p class="empty">🛒 Belum ada item</p>';
  } else {
    container.innerHTML = cart.map(i => `
      <div class="cart-item">
        <div>
          <div class="name">${i.name}</div>
          <div class="price">Rp ${formatNumber(i.price)} × ${i.qty}</div>
        </div>
        <div class="qty">
          <button onclick="changeQty('${i.id}',-1)">−</button>
          <span class="qty-num">${i.qty}</span>
          <button onclick="changeQty('${i.id}',1)">+</button>
        </div>
      </div>
    `).join('');
  }
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = Number(document.getElementById('cartDiscount')?.value) || 0;
  document.getElementById('cartSubtotal').textContent = 'Rp ' + formatNumber(subtotal);
  document.getElementById('cartTotal').textContent = 'Rp ' + formatNumber(subtotal - discount);
}

function updateFab() {
  const fab = document.getElementById('fabCart');
  const count = cart.reduce((s, i) => s + i.qty, 0);
  if (count > 0) {
    fab.classList.remove('hidden');
    document.getElementById('fabCount').textContent = count;
  } else {
    fab.classList.add('hidden');
  }
}

function openCart() {
  if (cart.length === 0) return alert('Keranjang kosong');
  renderCart();
  document.getElementById('cartModal').classList.remove('hidden');
}
function closeCart() { document.getElementById('cartModal').classList.add('hidden'); }

// ============================================================
// 8. PEMBAYARAN
// ============================================================
async function payCash() {
  if (cart.length === 0) return;
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0)
              - (Number(document.getElementById('cartDiscount').value) || 0);
  const paid = prompt(`Total: Rp ${formatNumber(total)}\n\nMasukkan uang tunai:`);
  if (paid === null) return;
  const cash = Number(paid);
  if (cash < total) return alert('Uang tidak cukup');
  alert('Kembalian: Rp ' + formatNumber(cash - total));
  await saveTransaction('cash', total);
}

async function payQRIS() {
  if (cart.length === 0) return;
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0)
              - (Number(document.getElementById('cartDiscount').value) || 0);
  const orderId = 'TRX' + Date.now();
  const slug = 'GANTI-SLUG-PAKASIR-ANDA';
  const pakasirUrl = `https://app.pakasir.com/pay/${slug}/${total}?order_id=${orderId}&qris_only=1`;
  window.open(pakasirUrl, '_blank');
  alert(`📱 Selesaikan pembayaran di tab baru.\n\nOrder: ${orderId}\nTotal: Rp ${formatNumber(total)}\n\nKlik OK jika sudah dibayar.`);
  await saveTransaction('qris', total);
}

async function saveTransaction(method, total) {
  const trxNumber = 'TRX' + Date.now();
  const { data: trx, error } = await db.from('transactions').insert({
    transaction_number: trxNumber,
    cashier_id: currentUser.id,
    total_amount: total,
    discount: Number(document.getElementById('cartDiscount').value) || 0,
    payment_method: method,
    payment_status: 'paid'
  }).select().single();

  if (error) return alert('Gagal: ' + error.message);

  await db.from('transaction_items').insert(cart.map(i => ({
    transaction_id: trx.id,
    product_id: i.id,
    quantity: i.qty,
    unit_price: i.price,
    subtotal: i.price * i.qty
  })));

  for (const i of cart) {
    const p = products.find(x => x.id === i.id);
    if (p) await db.from('products').update({ stock: p.stock - i.qty }).eq('id', i.id);
  }

  alert('✅ Transaksi berhasil!\n' + trxNumber);
  cart = [];
  document.getElementById('cartDiscount').value = 0;
  closeCart();
  await loadProducts();
  renderProducts();
  renderCart();
  updateFab();
  loadDashboard();
}

function holdBill() {
  if (cart.length === 0) return;
  localStorage.setItem('kasir-hold', JSON.stringify(cart));
  cart = [];
  renderCart();
  updateFab();
  closeCart();
  alert('Pesanan ditahan');
}

// ============================================================
// 9. DASHBOARD
// ============================================================
async function loadDashboard() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: trx } = await db.from('transactions')
    .select('*').gte('created_at', today.toISOString())
    .order('created_at', { ascending: false });

  const list = trx || [];
  document.getElementById('dashTotalTrx').textContent = list.length;
  const revenue = list.reduce((s, t) => s + Number(t.total_amount), 0);
  document.getElementById('dashRevenue').textContent = 'Rp ' + formatNumber(revenue);

  // Recent transactions (5)
  document.getElementById('recentTrxList').innerHTML = list.slice(0, 5).map(t => `
    <div class="trx-item">
      <div class="trx-icon">🧾</div>
      <div class="info">
        <div class="title">${t.transaction_number}</div>
        <div class="amount">Rp ${formatNumber(t.total_amount)}</div>
      </div>
      <div style="text-align:right;">
        <div class="time">${new Date(t.created_at).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</div>
        <div class="badge green">${t.payment_method}</div>
      </div>
    </div>
  `).join('') || '<div style="text-align:center;color:var(--text-dim);padding:30px;">Belum ada transaksi hari ini</div>';
}

// ============================================================
// 10. PRODUK (Manajemen)
// ============================================================
async function loadProductsTable() {
  await loadProducts();
  const search = (document.getElementById('searchProdukPage')?.value || '').toLowerCase();
  const list = products.filter(p => !search || p.name.toLowerCase().includes(search));

  document.getElementById('productList').innerHTML = list.map(p => `
    <div class="product-item">
      ${p.image_url ? `<img src="${p.image_url}" alt="">` : '<div class="no-img">🍽️</div>'}
      <div class="info">
        <div class="name">${p.name}</div>
        <div class="meta">${p.sku ? 'SKU: ' + p.sku + ' · ' : ''}${p.category || '-'}</div>
        <div class="price-row">
          <span class="price">Rp ${formatNumber(p.price)}</span>
          <span class="cost">Modal: Rp ${formatNumber(p.cost_price || 0)}</span>
        </div>
        <div class="meta" style="margin-top:4px;">Stok: <b>${p.stock}</b></div>
      </div>
      <div class="actions">
        <button onclick="editProduct('${p.id}')" title="Edit">✏️</button>
        <button onclick="deleteProduct('${p.id}')" title="Hapus">🗑️</button>
      </div>
    </div>
  `).join('') || '<div style="text-align:center;color:var(--text-dim);padding:30px;">Belum ada produk</div>';
}

function openProductModal() {
  document.getElementById('productModalTitle').textContent = 'Tambah Produk';
  ['prodName','prodSKU','prodPrice','prodCost','prodStock','prodCategory','prodImage','prodEditId']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('productModal').classList.remove('hidden');
}
function closeProductModal() { document.getElementById('productModal').classList.add('hidden'); }

async function saveProduct() {
  const payload = {
    name: document.getElementById('prodName').value,
    sku: document.getElementById('prodSKU').value,
    price: Number(document.getElementById('prodPrice').value),
    cost_price: Number(document.getElementById('prodCost').value) || 0,
    stock: Number(document.getElementById('prodStock').value) || 0,
    category: document.getElementById('prodCategory').value,
    image_url: document.getElementById('prodImage').value || null,
    is_active: true
  };
  const editId = document.getElementById('prodEditId').value;
  const { error } = editId
    ? await db.from('products').update(payload).eq('id', editId)
    : await db.from('products').insert(payload);
  if (error) return alert('Gagal: ' + error.message);
  closeProductModal();
  await loadProductsTable();
  await loadCategories();
  renderProducts();
}

function editProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('productModalTitle').textContent = 'Edit Produk';
  document.getElementById('prodName').value = p.name;
  document.getElementById('prodSKU').value = p.sku || '';
  document.getElementById('prodPrice').value = p.price;
  document.getElementById('prodCost').value = p.cost_price || 0;
  document.getElementById('prodStock').value = p.stock;
  document.getElementById('prodCategory').value = p.category || '';
  document.getElementById('prodImage').value = p.image_url || '';
  document.getElementById('prodEditId').value = p.id;
  document.getElementById('productModal').classList.remove('hidden');
}

async function deleteProduct(id) {
  if (!confirm('Yakin hapus produk ini?')) return;
  await db.from('products').update({ is_active: false }).eq('id', id);
  await loadProductsTable();
  await loadProducts();
  renderProducts();
}

// ============================================================
// 11. LAPORAN
// ============================================================
function setReportRange(range, btn) {
  reportRange = range;
  document.querySelectorAll('.filter-tabs .tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadReport();
}

async function loadReport() {
  const now = new Date();
  let from = new Date();
  if (reportRange === 'today') from.setHours(0, 0, 0, 0);
  else if (reportRange === '7d') from.setDate(now.getDate() - 7);
  else if (reportRange === '30d') from.setDate(now.getDate() - 30);

  const { data: trx } = await db.from('transactions')
    .select('*').gte('created_at', from.toISOString());

  const list = trx || [];
  const revenue = list.reduce((s, t) => s + Number(t.total_amount), 0);
  document.getElementById('statCount').textContent = list.length;
  document.getElementById('statRevenue').textContent = 'Rp ' + formatNumber(revenue);

  let profit = 0;
  const { data: allItems } = await db.from('transaction_items').select('*')
    .in('transaction_id', list.map(t => t.id).length ? list.map(t => t.id) : ['00000000-0000-0000-0000-000000000000']);

  const map = {};
  (allItems || []).forEach(it => {
    const p = products.find(x => x.id === it.product_id);
    const modal = p?.cost_price || 0;
    profit += (it.unit_price - modal) * it.quantity;
    if (!map[it.product_id]) map[it.product_id] = { qty: 0, revenue: 0 };
    map[it.product_id].qty += it.quantity;
    map[it.product_id].revenue += Number(it.subtotal);
  });
  document.getElementById('statProfit').textContent = 'Rp ' + formatNumber(profit);

  const top = Object.entries(map).map(([id, v]) => ({
    name: products.find(p => p.id === id)?.name || 'Terhapus', ...v
  })).sort((a, b) => b.qty - a.qty).slice(0, 10);

  document.getElementById('topProductsList').innerHTML = top.map((t, i) => `
    <div class="trx-item">
      <div class="trx-icon" style="background:var(--orange-soft);">${['🥇','🥈','🥉'][i] || '🏅'}</div>
      <div class="info">
        <div class="title">${t.name}</div>
        <div class="time">Terjual ${t.qty} pcs</div>
      </div>
      <div style="text-align:right;">
        <div class="amount">Rp ${formatNumber(t.revenue)}</div>
      </div>
    </div>
  `).join('') || '<div style="text-align:center;color:var(--text-dim);padding:30px;">Belum ada data</div>';
}

function exportReport() { alert('Fitur export akan hadir di versi berikutnya.'); }

// 12. PIUTANG
// ============================================================
function openReceivableModal() { document.getElementById('receivableModal').classList.remove('hidden'); }
function closeReceivableModal() { document.getElementById('receivableModal').classList.add('hidden'); }

async function saveReceivable() {
  const total = Number(document.getElementById('rcvAmount').value);
  const paid = Number(document.getElementById('rcvPaid').value) || 0;
  const status = paid === 0 ? 'unpaid' : (paid >= total ? 'paid' : 'partial');
  const { error } = await db.from('receivables').insert({
    customer_name: document.getElementById('rcvName').value,
    customer_phone: document.getElementById('rcvPhone').value,
    total_amount: total,
    paid_amount: paid,
    status,
    due_date: document.getElementById('rcvDue').value || null
  });
  if (error) return alert('Gagal: ' + error.message);
  closeReceivableModal();
  loadReceivables();
}

async function loadReceivables() {
  const { data } = await db.from('receivables').select('*').order('created_at', { ascending: false });
  document.getElementById('receivableList').innerHTML = (data || []).map(r => `
    <div class="trx-item">
      <div class="trx-icon" style="background:var(--orange-soft);">👤</div>
      <div class="info">
        <div class="title">${r.customer_name}</div>
        <div class="time">${r.customer_phone || '-'} · Jatuh tempo: ${r.due_date || '-'}</div>
        <div class="amount">Rp ${formatNumber(r.paid_amount)} / Rp ${formatNumber(r.total_amount)}</div>
      </div>
      <div style="text-align:right;">
        <div class="badge ${r.status === 'paid' ? 'green' : r.status === 'partial' ? 'orange' : 'red'}">
          ${r.status === 'paid' ? 'Lunas' : r.status === 'partial' ? 'Sebagian' : 'Belum'}
        </div>
        ${r.status !== 'paid' ? `<button onclick="payReceivable('${r.id}', ${r.total_amount}, ${r.paid_amount})" class="btn-outline" style="margin-top:6px; padding:6px 10px; font-size:11px;">Bayar</button>` : ''}
      </div>
    </div>
  `).join('') || '<div style="text-align:center;color:var(--text-dim);padding:30px;">Belum ada piutang</div>';
}

async function payReceivable(id, total, paid) {
  const input = prompt(`Sisa: Rp ${formatNumber(total - paid)}\nMasukkan jumlah bayar:`);
  if (input === null) return;
  const newPaid = paid + Number(input);
  const status = newPaid >= total ? 'paid' : 'partial';
  await db.from('receivables').update({ paid_amount: newPaid, status }).eq('id', id);
  loadReceivables();
}

// ============================================================
// 13. SHIFT
// ============================================================
async function loadShift() {
  const { data } = await db.from('shifts')
    .select('*').eq('cashier_id', currentUser.id).is('closed_at', null)
    .order('opened_at', { ascending: false }).limit(1);
  const active = data && data[0];
  document.getElementById('shiftStatus').innerHTML = active
    ? `<b>🟢 Shift Aktif</b><br>Sejak: ${new Date(active.opened_at).toLocaleString('id-ID')}<br>Kas awal: <b>Rp ${formatNumber(active.opening_balance)}</b>`
    : '<b>🔴 Tidak ada shift aktif</b><br>Silakan buka shift terlebih dahulu.';
}

async function openShift() {
  const balance = Number(document.getElementById('openingBalance').value) || 0;
  await db.from('shifts').insert({ cashier_id: currentUser.id, opening_balance: balance });
  document.getElementById('openingBalance').value = '';
  loadShift();
}

async function closeShift() {
  const balance = Number(document.getElementById('closingBalance').value) || 0;
  const { data } = await db.from('shifts')
    .select('id').eq('cashier_id', currentUser.id).is('closed_at', null)
    .order('opened_at', { ascending: false }).limit(1);
  if (!data || !data[0]) return alert('Tidak ada shift aktif');
  await db.from('shifts').update({
    closing_balance: balance, closed_at: new Date().toISOString()
  }).eq('id', data[0].id);
  document.getElementById('closingBalance').value = '';
  loadShift();
}

// ============================================================
// 14. ABSENSI
// ============================================================
let cameraStream = null;
async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    document.getElementById('camera').srcObject = cameraStream;
  } catch (e) { alert('Tidak bisa akses kamera: ' + e.message); }
}

async function doAttendance(type) {
  if (!cameraStream) return alert('Aktifkan kamera dulu');
  const video = document.getElementById('camera');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg');

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    const blob = await (await fetch(dataUrl)).blob();
    const fileName = `${currentUser.id}_${Date.now()}.jpg`;
    const { error: upErr } = await db.storage.from('attendance').upload(fileName, blob);
    let photoUrl = null;
    if (!upErr) {
      const { data: urlData } = db.storage.from('attendance').getPublicUrl(fileName);
      photoUrl = urlData.publicUrl;
    }
    await db.from('attendance').insert({
      user_id: currentUser.id, type, photo_url: photoUrl, latitude, longitude
    });
    alert(`✅ Absen ${type === 'check_in' ? 'masuk' : 'keluar'} berhasil`);
    loadAttendance();
  }, (err) => alert('Gagal ambil lokasi: ' + err.message));
}

async function loadAttendance() {
  const { data } = await db.from('attendance')
    .select('*').eq('user_id', currentUser.id)
    .order('recorded_at', { ascending: false }).limit(20);
  document.getElementById('attendanceBody').innerHTML = (data || []).map(a => `
    <div class="trx-item">
      <div class="trx-icon" style="background:${a.type === 'check_in' ? 'var(--green-soft)' : 'var(--red-soft)'};">
        ${a.type === 'check_in' ? '✅' : '🚪'}
      </div>
      <div class="info">
        <div class="title">${a.type === 'check_in' ? 'Absen Masuk' : 'Absen Keluar'}</div>
        <div class="time">${new Date(a.recorded_at).toLocaleString('id-ID')}</div>
        <div class="time">${a.latitude ? `${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)}` : '-'}</div>
      </div>
    </div>
  `).join('') || '<div style="text-align:center;color:var(--text-dim);padding:30px;">Belum ada absensi</div>';
}

// ============================================================
// 15. RIWAYAT TRANSAKSI
// ============================================================
async function loadTransactions() {
  const { data } = await db.from('transactions')
    .select('*').order('created_at', { ascending: false }).limit(50);
  document.getElementById('trxBody').innerHTML = (data || []).map(t => `
    <div class="trx-item" onclick="viewTrxDetail('${t.id}', '${t.transaction_number}')">
      <div class="trx-icon">🧾</div>
      <div class="info">
        <div class="title">${t.transaction_number}</div>
        <div class="time">${new Date(t.created_at).toLocaleString('id-ID')}</div>
        <div class="amount">Rp ${formatNumber(t.total_amount)}</div>
      </div>
      <div class="badge ${t.payment_method === 'cash' ? 'green' : 'orange'}">${t.payment_method}</div>
    </div>
  `).join('') || '<div style="text-align:center;color:var(--text-dim);padding:30px;">Belum ada transaksi</div>';
}

async function viewTrxDetail(id, number) {
  const { data } = await db.from('transaction_items').select('*').eq('transaction_id', id);
  const text = (data || []).map(i => `• ${i.quantity}× Rp ${formatNumber(i.unit_price)} = Rp ${formatNumber(i.subtotal)}`).join('\n');
  alert(`🧾 ${number}\n\n${text || 'Tidak ada item'}`);
}

// ============================================================
// 16. LAINNYA
// ============================================================
function openLainnya() { document.getElementById('lainnyaModal').classList.remove('hidden'); }
function closeLainnya() { document.getElementById('lainnyaModal').classList.add('hidden'); }
