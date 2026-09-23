// 1. KONFIGURASI SUPABASE
// Ganti dua baris di bawah dengan milik Anda:
// Supabase Dashboard → Settings → API
// ============================================================
const SUPABASE_URL = 'https://pxvvdowqiesbhngumktn.supabase.co';   // ← GANTI
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4dnZkb3dxaWVzYmhuZ3Vta3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNzAwNTIsImV4cCI6MjEwNTc0NjA1Mn0.fTwhIhy09d8qkIUWY0RHVbJxz0mue1z5AmOR8ncfMMc';          // ← GANTI
// ============================================================
// 1b. KONFIGURASI PAKASIR (dari dashboard Pakasir)
// ============================================================
const PAKASIR_SLUG = 'kasir-toko-saya';              // ← GANTI dengan Slug proyek Anda
const PAKASIR_API_KEY = 'KiAMlXHZ1y7zJgPE95dB2SpvIlrXdbtU'; // ← GANTI dengan API Key proyek Anda

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// 2. VARIABEL GLOBAL
// ============================================================
let currentUser = null;
let currentProfile = null;
let products = [];
let cart = [];
let categories = [];
let activeCategory = 'all';

// ============================================================
// 3. AUTENTIKASI
// ============================================================
async function doLogin() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const msg = document.getElementById('loginMsg');
  msg.textContent = 'Memproses...';

  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) { msg.textContent = '❌ ' + error.message; return; }

  currentUser = data.user;
  await loadProfile();
  showApp();
}

async function doRegister() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const msg = document.getElementById('loginMsg');

  const { data, error } = await db.auth.signUp({ email, password });
  if (error) { msg.textContent = '❌ ' + error.message; return; }

  // Buat profil default (role: kasir)
  if (data.user) {
    await db.from('profiles').insert({
      id: data.user.id,
      full_name: email.split('@')[0],
      role: 'kasir',
      is_active: true
    });
  }
  msg.textContent = '✅ Akun dibuat! Silakan login.';
  msg.style.color = 'var(--accent)';
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
  document.getElementById('userInfo').textContent =
    `${currentProfile.full_name} (${currentProfile.role})`;
  initApp();
}

// Cek sesi saat halaman dibuka
(async () => {
  const { data } = await db.auth.getSession();
  if (data.session) {
    currentUser = data.session.user;
    await loadProfile();
    showApp();
  }
})();

// ============================================================
// 4. NAVIGASI HALAMAN
// ============================================================
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const page = btn.dataset.page;
    document.getElementById('page-' + page).classList.add('active');

    if (page === 'produk') loadProductsTable();
    if (page === 'laporan') loadReport();
    if (page === 'piutang') loadReceivables();
    if (page === 'shift') loadShift();
    if (page === 'absensi') loadAttendance();
    if (page === 'riwayat') loadTransactions();
  });
});

// ============================================================
// 5. TEMA WARNA
// ============================================================
function changeTheme(theme) {
  document.body.className = theme === 'dark' ? '' : 'theme-' + theme;
  localStorage.setItem('kasir-theme', theme);
}
// Muat tema tersimpan
const savedTheme = localStorage.getItem('kasir-theme') || 'dark';
document.getElementById('themeSelect').value = savedTheme;
changeTheme(savedTheme);

// ============================================================
// 6. INIT APLIKASI
// ============================================================
async function initApp() {
  await loadCategories();
  await loadProducts();
  renderProducts();
  await loadShift();
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
  document.querySelectorAll('.cat-list button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProducts();
}

async function loadProducts() {
  const { data, error } = await db.from('products').select('*').eq('is_active', true).order('name');
  if (error) { alert('Gagal memuat produk: ' + error.message); return; }
  products = data || [];
}

function renderProducts() {
  const search = document.getElementById('searchProduct').value.toLowerCase();
  const filtered = products.filter(p =>
    (activeCategory === 'all' || p.category === activeCategory) &&
    (!search || p.name.toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search))
  );

  document.getElementById('productGrid').innerHTML = filtered.map(p => `
    <div class="product-card" onclick="addToCart('${p.id}')">
      ${p.image_url ? `<img src="${p.image_url}" alt="">` : ''}
      <div class="name">${p.name}</div>
      <div class="price">Rp ${formatNumber(p.price)}</div>
      <div class="stock">Stok: ${p.stock}</div>
    </div>
  `).join('') || '<p style="color:var(--text-dim)">Tidak ada produk</p>';
}

// ============================================================
// 7. KERANJANG
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
}

function changeQty(id, delta) {
  const item = cart.find(x => x.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(x => x.id !== id);
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cartItems');
  if (cart.length === 0) {
    container.innerHTML = '<p class="empty">Belum ada item</p>';
  } else {
    container.innerHTML = cart.map(i => `
      <div class="cart-item">
        <div>
          <div>${i.name}</div>
          <div style="color:var(--text-dim);font-size:11px">Rp ${formatNumber(i.price)}</div>
        </div>
        <div class="qty">
          <button onclick="changeQty('${i.id}',-1)">−</button>
          <span>${i.qty}</span>
          <button onclick="changeQty('${i.id}',1)">+</button>
        </div>
      </div>
    `).join('');
  }
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = Number(document.getElementById('cartDiscount').value) || 0;
  document.getElementById('cartSubtotal').textContent = 'Rp ' + formatNumber(subtotal);
  document.getElementById('cartTotal').textContent = 'Rp ' + formatNumber(subtotal - discount);
}

function formatNumber(n) { return new Intl.NumberFormat('id-ID').format(n || 0); }

// ============================================================
// 8. PEMBAYARAN
// ============================================================
async function payCash() {
  if (cart.length === 0) return alert('Keranjang kosong');
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0)
              - (Number(document.getElementById('cartDiscount').value) || 0);
  const paid = prompt(`Total: Rp ${formatNumber(total)}\nMasukkan uang tunai:`);
  if (paid === null) return;
  const cash = Number(paid);
  if (cash < total) return alert('Uang tidak cukup');
  alert('Kembalian: Rp ' + formatNumber(cash - total));
  await saveTransaction('cash', total);
}

async function payQRIS() {
  if (cart.length === 0) return alert('Keranjang kosong');

  // 1. Hitung total
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0)
              - (Number(document.getElementById('cartDiscount').value) || 0);

  // 2. Buat order ID unik
  const orderId = 'TRX' + Date.now();

  // 3. GANTI DENGAN SLUG PAKASIR ANDA
  const SLUG = 'kasir-toko-saya';   // ← GANTI!

  // 4. Bangun URL
  const pakasirUrl = `https://app.pakasir.com/pay/${SLUG}/${total}?order_id=${orderId}&qris_only=1`;

  // 5. Simpan transaksi dulu dengan status "pending"
  const { data: trx } = await db.from('transactions').insert({
    transaction_number: orderId,
    cashier_id: currentUser.id,
    total_amount: total,
    discount: Number(document.getElementById('cartDiscount').value) || 0,
    payment_method: 'qris',
    payment_status: 'pending',
    qris_order_id: orderId
  }).select().single();

  // 6. Simpan detail item
  if (trx) {
    const items = cart.map(i => ({
      transaction_id: trx.id,
      product_id: i.id,
      quantity: i.qty,
      unit_price: i.price,
      subtotal: i.price * i.qty
    }));
    await db.from('transaction_items').insert(items);
  }

  // 7. Buka halaman pembayaran Pakasir di tab baru
  window.open(pakasirUrl, '_blank');

  // 8. Info ke kasir
  alert(
    `📱 Halaman QRIS sudah dibuka di tab baru.\n\n` +
    `Nomor Order: ${orderId}\n` +
    `Total: Rp ${formatNumber(total)}\n\n` +
    `Minta pelanggan scan QR di tab tersebut.\n` +
    `Setelah pelanggan selesai bayar, klik OK di sini untuk menyelesaikan transaksi.`
  );

  // 9. Update status jadi paid + kurangi stok
  await completePayment(trx.id, orderId);
}

async function completePayment(trxId, orderId) {
  // Update transaksi
  await db.from('transactions')
    .update({ payment_status: 'paid' })
    .eq('id', trxId);

  // Kurangi stok
  for (const i of cart) {
    const p = products.find(x => x.id === i.id);
    if (p) {
      await db.from('products').update({ stock: p.stock - i.qty }).eq('id', i.id);
    }
  }

  // Reset keranjang
  cart = [];
  document.getElementById('cartDiscount').value = 0;
  await loadProducts();
  renderProducts();
  renderCart();

  alert('✅ Transaksi selesai! Nomor: ' + orderId);
}

async function saveTransaction(method, total) {
  const trxNumber = 'TRX' + Date.now();
  const { data: trx, error: errTrx } = await db.from('transactions').insert({
    transaction_number: trxNumber,
    cashier_id: currentUser.id,
    total_amount: total,
    discount: Number(document.getElementById('cartDiscount').value) || 0,
    payment_method: method,
    payment_status: 'paid'
  }).select().single();

  if (errTrx) return alert('Gagal simpan transaksi: ' + errTrx.message);

  // Simpan detail
  const items = cart.map(i => ({
    transaction_id: trx.id,
    product_id: i.id,
    quantity: i.qty,
    unit_price: i.price,
    subtotal: i.price * i.qty
  }));
  await db.from('transaction_items').insert(items);

  // Update stok
  for (const i of cart) {
    const p = products.find(x => x.id === i.id);
    await db.from('products').update({ stock: p.stock - i.qty }).eq('id', i.id);
  }

  alert('✅ Transaksi berhasil!\nNo: ' + trxNumber);
  cart = [];
  document.getElementById('cartDiscount').value = 0;
  await loadProducts();
  renderProducts();
  renderCart();
}

function holdBill() {
  if (cart.length === 0) return;
  localStorage.setItem('kasir-hold', JSON.stringify(cart));
  cart = [];
  renderCart();
  alert('Transaksi ditahan');
}

// ============================================================
// 9. MANAJEMEN PRODUK
// ============================================================
async function loadProductsTable() {
  await loadProducts();
  document.getElementById('productTableBody').innerHTML = products.map(p => `
    <tr>
      <td>${p.name}</td>
      <td>${p.sku || '-'}</td>
      <td>Rp ${formatNumber(p.price)}</td>
      <td>${p.stock}</td>
      <td>
        <button class="btn-secondary" onclick="editProduct('${p.id}')">Edit</button>
        <button class="btn-ghost" onclick="deleteProduct('${p.id}')">Hapus</button>
      </td>
    </tr>
  `).join('');
}

function openProductModal() {
  document.getElementById('productModalTitle').textContent = 'Tambah Produk';
  ['prodName','prodSKU','prodPrice','prodCost','prodStock','prodCategory','prodImage','prodEditId']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('productModal').classList.remove('hidden');
}

function closeProductModal() {
  document.getElementById('productModal').classList.add('hidden');
}

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
  let error;
  if (editId) {
    ({ error } = await db.from('products').update(payload).eq('id', editId));
  } else {
    ({ error } = await db.from('products').insert(payload));
  }
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
// 10. LAPORAN
// ============================================================
async function loadReport() {
  const from = document.getElementById('reportFrom').value || '2000-01-01';
  const to = document.getElementById('reportTo').value || '2100-01-01';

  const { data: trx } = await db.from('transactions')
    .select('*').gte('created_at', from).lte('created_at', to + 'T23:59:59');

  const list = trx || [];
  const revenue = list.reduce((s, t) => s + Number(t.total_amount), 0);
  document.getElementById('statRevenue').textContent = 'Rp ' + formatNumber(revenue);
  document.getElementById('statCount').textContent = list.length;
  document.getElementById('statAvg').textContent = 'Rp ' + formatNumber(list.length ? revenue / list.length : 0);

  // Estimasi profit (revenue - modal)
  let profit = 0;
  for (const t of list) {
    const { data: items } = await db.from('transaction_items').select('*').eq('transaction_id', t.id);
    for (const it of items || []) {
      const p = products.find(x => x.id === it.product_id);
      const modal = p?.cost_price || 0;
      profit += (it.unit_price - modal) * it.quantity;
    }
  }
  document.getElementById('statProfit').textContent = 'Rp ' + formatNumber(profit);

  // Produk terlaris
  const { data: allItems } = await db.from('transaction_items').select('*');
  const map = {};
  (allItems || []).forEach(it => {
    if (!map[it.product_id]) map[it.product_id] = { qty: 0, revenue: 0 };
    map[it.product_id].qty += it.quantity;
    map[it.product_id].revenue += Number(it.subtotal);
  });
  const top = Object.entries(map).map(([id, v]) => ({
    name: products.find(p => p.id === id)?.name || 'Terhapus',
    ...v
  })).sort((a, b) => b.qty - a.qty).slice(0, 10);

  document.getElementById('topProductsBody').innerHTML = top.map(t => `
    <tr><td>${t.name}</td><td>${t.qty}</td><td>Rp ${formatNumber(t.revenue)}</td></tr>
  `).join('') || '<tr><td colspan="3">Tidak ada data</td></tr>';
}

// ============================================================
// 11. PIUTANG
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
  document.getElementById('receivableBody').innerHTML = (data || []).map(r => `
    <tr>
      <td>${r.customer_name}<br><small style="color:var(--text-dim)">${r.customer_phone || ''}</small></td>
      <td>Rp ${formatNumber(r.total_amount)}</td>
      <td>Rp ${formatNumber(r.paid_amount)}</td>
      <td>${statusLabel(r.status)}</td>
      <td>${r.due_date || '-'}</td>
      <td>
        <button class="btn-secondary" onclick="payReceivable('${r.id}', ${r.total_amount}, ${r.paid_amount})">Bayar</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6">Belum ada piutang</td></tr>';
}

function statusLabel(s) {
  if (s === 'paid') return '✅ Lunas';
  if (s === 'partial') return '🟡 Sebagian';
  return '🔴 Belum Lunas';
}

async function payReceivable(id, total, paid) {
  const input = prompt(`Sisa: Rp ${formatNumber(total - paid)}\nMasukkan jumlah bayar:`);
  if (input === null) return;
  const amount = Number(input);
  const newPaid = paid + amount;
  const status = newPaid >= total ? 'paid' : 'partial';
  await db.from('receivables').update({ paid_amount: newPaid, status }).eq('id', id);
  loadReceivables();
}

// ============================================================
// 12. SHIFT
// ============================================================
async function loadShift() {
  const { data } = await db.from('shifts')
    .select('*').eq('cashier_id', currentUser.id).is('closed_at', null)
    .order('opened_at', { ascending: false }).limit(1);
  const active = data && data[0];
  document.getElementById('shiftStatus').innerHTML = active
    ? `<p>🟢 Shift aktif sejak <b>${new Date(active.opened_at).toLocaleString('id-ID')}</b></p>
       <p>Kas awal: <b>Rp ${formatNumber(active.opening_balance)}</b></p>`
    : '<p>🔴 Tidak ada shift aktif</p>';
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
    closing_balance: balance,
    closed_at: new Date().toISOString()
  }).eq('id', data[0].id);
  document.getElementById('closingBalance').value = '';
  loadShift();
}

// ============================================================
// 13. ABSENSI (dengan kamera + GPS)
// ============================================================
let cameraStream = null;

async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
    document.getElementById('camera').srcObject = cameraStream;
  } catch (e) {
    alert('Tidak bisa akses kamera: ' + e.message);
  }
}

async function doAttendance(type) {
  if (!cameraStream) return alert('Aktifkan kamera dulu');

  // Ambil foto dari video
  const video = document.getElementById('camera');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg');

   // Ambil lokasi
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    // Upload foto ke Supabase Storage (bucket: attendance)
    const blob = await (await fetch(dataUrl)).blob();
    const fileName = `${currentUser.id}_${Date.now()}.jpg`;
    const { error: upErr } = await db.storage.from('attendance').upload(fileName, blob);
    let photoUrl = null;
    if (!upErr) {
      const { data: urlData } = db.storage.from('attendance').getPublicUrl(fileName);
      photoUrl = urlData.publicUrl;
    }

    await db.from('attendance').insert({
      user_id: currentUser.id,
      type,
      photo_url: photoUrl,
      latitude, longitude
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
    <tr>
      <td>${new Date(a.recorded_at).toLocaleString('id-ID')}</td>
      <td>${a.type === 'check_in' ? '🟢 Masuk' : '🔴 Keluar'}</td>
      <td>${a.latitude ? `${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)}` : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="3">Belum ada absensi</td></tr>';
}

// ============================================================
// 14. RIWAYAT TRANSAKSI
// ============================================================
async function loadTransactions() {
  const { data } = await db.from('transactions')
    .select('*').order('created_at', { ascending: false }).limit(50);
  document.getElementById('trxBody').innerHTML = (data || []).map(t => `
    <tr>
      <td>${t.transaction_number}</td>
      <td>${new Date(t.created_at).toLocaleString('id-ID')}</td>
      <td>${t.payment_method}</td>
      <td>Rp ${formatNumber(t.total_amount)}</td>
      <td><button class="btn-ghost" onclick="viewTrxDetail('${t.id}')">Detail</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5">Belum ada transaksi</td></tr>';
}

async function viewTrxDetail(id) {
  const { data } = await db.from('transaction_items').select('*').eq('transaction_id', id);
  const text = (data || []).map(i => `• ${i.quantity}x Rp ${formatNumber(i.unit_price)} = Rp ${formatNumber(i.subtotal)}`).join('\n');
  alert('Detail Item:\n\n' + text);
}
