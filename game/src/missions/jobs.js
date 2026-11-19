// The 9 story jobs. Each is data: giver, dialog, and a chain of objectives.
// The engine in objectives.js walks the chain; the world supplies the rest.
export const CHARACTERS = {
  hasan: { name: 'HASAN OMBAK', role: 'Pemilik Kios Ikan', color: '#2f6db8', accent: '#f5a623' },
  laras: { name: 'LARAS', role: 'Mantan Pandu Pelabuhan', color: '#2f8a6a', accent: '#2fd3c4' },
  bimo: { name: 'BIMO KABEL', role: 'Teknisi Gardu & Penyiar', color: '#7a4a8a', accent: '#e0453a' },
  ratih: { name: 'MBAK RATIH', role: 'Ketua Koperasi Pasar', color: '#8a6a3a', accent: '#ede6d6' },
  garda: { name: 'GARDA BESI', role: 'Kepala Bea Cukai', color: '#3a3a3a', accent: '#f5a623' },
  nilam: { name: 'BU NILAM', role: 'Pemilik Jaringan', color: '#5a2a4a', accent: '#f5a623' },
};
export const JOBS = [
  { id: 1, title: 'Salam dari Dermaga', giver: 'hasan', type: 'Driving', reward: 800,
    start: { x: 120, z: -400 },
    dialog: [
      { who: 'hasan', text: 'Air naik jam empat, Nak. Kalau kau belum parkir sebelum itu, ikan ini yang bayar, bukan kau.' },
      { who: 'hasan', text: 'Pikap itu curian, tapi utangku bukan. Bawa keliling Sagara Hilir, lepaskan dua penagih itu.' },
    ],
    objectives: [
      { kind: 'goto', x: 60, z: -380, r: 8, text: 'Ambil pikap di dermaga' },
      { kind: 'escape', x: -200, z: -320, r: 10, text: 'Lepaskan penagih utang — jangan berhenti' },
      { kind: 'goto', x: 120, z: -400, r: 8, text: 'Kembali ke kios Hasan' },
    ] },
  { id: 2, title: 'Kargo Buta', giver: 'hasan', type: 'Delivery', reward: 1100,
    start: { x: 120, z: -400 }, tideGate: 'low',
    dialog: [
      { who: 'hasan', text: 'Enam peti tersegel. Jangan dibuka, jangan digoyang. Air surut menutup dermaga dalam dua puluh menit.' },
    ],
    objectives: [
      { kind: 'deliver', x: 60, z: -420, r: 8, text: 'Antar peti ke los pasar — tanpa penyok', time: 240 },
      { kind: 'goto', x: 120, z: -400, r: 8, text: 'Lapor ke Hasan' },
    ] },
  { id: 3, title: 'Telinga di 88.4', giver: 'bimo', type: 'Stealth', reward: 1300,
    start: { x: -270, z: -90 },
    dialog: [
      { who: 'bimo', text: 'Gardu pemancar bea cukai itu memindai tiap kapal. Potong dayanya — dan jangan sampai satu penjaga pun melihatmu.' },
      { who: 'bimo', text: 'Kalau ketahuan, siaranku yang pertama memberitakan penangkapanmu. Bercanda. Setengah bercanda.' },
    ],
    objectives: [
      { kind: 'stealth', x: -270, z: -180, r: 10, text: 'Masuk gardu tanpa terlihat', time: 180 },
      { kind: 'goto', x: -270, z: -90, r: 8, text: 'Kembali ke Bimo' },
    ] },
  { id: 4, title: 'Jendela Pasang', giver: 'laras', type: 'Escape', reward: 1800,
    start: { x: -45, z: -200 }, tideGate: 'high',
    dialog: [
      { who: 'laras', text: 'Kanal banjir itu hanya bisa dilayari saat pasang. Terlambat sepuluh menit dan kau jadi tontonan bea cukai.' },
      { who: 'laras', text: 'Aku hafal kanal ini di luar kepala. Kau tidak. Jadi ikuti airnya, bukan nalurimu.' },
    ],
    objectives: [
      { kind: 'goto', x: -45, z: -320, r: 10, text: 'Masuk kanal muara saat pasang' },
      { kind: 'deliver', x: 200, z: -330, r: 10, text: 'Buang muatan di dermaga bea cukai' },
    ] },
  { id: 5, title: 'Tiga Puluh Krat', giver: 'ratih', type: 'Delivery', reward: 1500,
    start: { x: -270, z: 0 }, tideGate: 'high',
    dialog: [
      { who: 'ratih', text: 'Tiga drop-off, berurutan, masing-masing sebelum garis pasang melewati dermaganya. Koperasi ini hidup dari ketepatanmu.' },
    ],
    objectives: [
      { kind: 'deliver', x: -300, z: -200, r: 8, text: 'Drop 1: Waringin Tepi utara', time: 150 },
      { kind: 'deliver', x: -200, z: 40, r: 8, text: 'Drop 2: Waringin Tepi selatan', time: 150 },
      { kind: 'deliver', x: -320, z: -40, r: 8, text: 'Drop 3: gang beringin', time: 150 },
    ] },
  { id: 6, title: 'Bidikan di Pasar Ikan', giver: 'laras', type: 'Shootout', reward: 2000,
    start: { x: 60, z: -420 },
    dialog: [
      { who: 'laras', text: 'Anak buah Garda Besi datang menagih lapak. Amunisi terbatas, lapak jadi pelindungmu. Tahan mereka.' },
    ],
    objectives: [
      { kind: 'kill', x: 60, z: -420, r: 30, count: 5, text: 'Usir 5 anak buah Garda Besi' },
      { kind: 'goto', x: 60, z: -420, r: 8, text: 'Koperasi aman — lapor ke Laras' },
    ] },
  { id: 7, title: 'Seragam Pinjaman', giver: 'garda', type: 'Infiltrasi', reward: 2400,
    start: { x: 220, z: -40 },
    dialog: [
      { who: 'garda', text: 'Kau akan memakai seragamku hari ini. Tanam pemancar di gudang inspeksi, lalu keluar tanpa alarm.' },
      { who: 'garda', text: 'Sopanlah. Bea cukai menghargai kesopanan — terutama dari orang yang sedang menjebaknya.' },
    ],
    objectives: [
      { kind: 'stealth', x: 220, z: -40, r: 10, text: 'Tanam pemancar di gudang inspeksi', time: 200 },
      { kind: 'escape', x: 100, z: 0, r: 10, text: 'Keluar Loji Cempaka tanpa alarm' },
    ] },
  { id: 8, title: 'Lampu Merah Muara', giver: 'nilam', type: 'Escape', reward: 2600,
    start: { x: -270, z: 0 },
    dialog: [
      { who: 'nilam', text: 'Rumah aman digerebek. Lintasi tiga distrik, lalu dinginkan buruan di lumpur surut. Polisi tidak bisa mengikutimu ke sana.' },
    ],
    objectives: [
      { kind: 'escape', x: 180, z: -315, r: 12, text: 'Kabur ke lumpur surut (tunggu air surut)' },
      { kind: 'survive', x: 180, z: -315, r: 14, time: 30, text: 'Bertahan 30 detik di lumpur' },
    ] },
  { id: 9, title: 'Pasang Tertinggi', giver: 'nilam', type: 'Finale', reward: 5000,
    start: { x: -45, z: -200 },
    dialog: [
      { who: 'nilam', text: 'Ruang kendali bendung. Naikkan pintu air, banjiri lapangan bea cukai — lalu kabur lewat Jembatan Sekarwangi.' },
      { who: 'nilam', text: 'Setelah ini, muara ini milik siapa pun yang berani mengaturnya. Termasuk kau.' },
    ],
    objectives: [
      { kind: 'stealth', x: -45, z: -300, r: 10, text: 'Masuk ruang kendali bendung', time: 200 },
      { kind: 'goto', x: -45, z: -315, r: 8, text: 'Naikkan pintu air' },
      { kind: 'escape', x: -45, z: 0, r: 12, text: 'Kabur lewat Jembatan Sekarwangi' },
    ] },
];
