import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  signInAnonymously,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection,
  onSnapshot
} from 'firebase/firestore';

// --- Firebase Başlatma (Environment Variables ile) ---
// Vercel veya Vite ortamında değişkenler import.meta.env üzerinden okunur.
// VITE_ ön eki zorunludur.

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Eğer yerel ortamda veya IDX'te __firebase_config tanımlıysa onu kullan (Geriye dönük uyumluluk)
const finalConfig = (typeof __firebase_config !== 'undefined') 
    ? JSON.parse(__firebase_config) 
    : firebaseConfig;

// Config boşsa (henüz tanımlanmamışsa) hata vermemesi için kontrol eklenebilir
// Ancak Firebase'in çalışması için bu değerlerin olması şarttır.
const app = initializeApp(finalConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'koha-label-maker'; 
const googleProvider = new GoogleAuthProvider();

// --- Script Yükleyici Hook ---
const useScriptLoader = (scripts) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let loadedCount = 0;
    const total = scripts.length;

    scripts.forEach(src => {
      if (document.querySelector(`script[src="${src}"]`)) {
        loadedCount++;
        if (loadedCount === total) setLoaded(true);
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        loadedCount++;
        if (loadedCount === total) setLoaded(true);
      };
      script.onerror = () => setError(`Script yüklenemedi: ${src}`);
      document.head.appendChild(script);
    });
  }, [scripts]);

  return { loaded, error };
};

// --- Yardımcı Bileşenler ---

const Barcode = ({ text, height = 35 }) => {
  const svgRef = useRef(null);
  
  useEffect(() => {
    if (svgRef.current && text && window.JsBarcode) {
      try {
        const barcodeValue = String(text).slice(0, 16); 
        window.JsBarcode(svgRef.current, barcodeValue, {
          format: "CODE128",
          displayValue: true,
          text: barcodeValue,
          textPosition: "bottom",
          fontSize: 12,
          textMargin: 2,
          height: height,
          width: 1.5,
          margin: 2
        });
      } catch (e) {
        console.error(`JsBarcode hatası: Barkod "${text}" oluşturulamadı.`, e);
      }
    }
  }, [text, height]);

  return <svg ref={svgRef} className="max-w-full" />;
};

const QRCode = ({ text, size = '25mm' }) => {
  const qrRef = useRef(null);
  
  useEffect(() => {
    if (qrRef.current && text && window.qrcode) {
      qrRef.current.innerHTML = '';
      try {
        const typeNumber = 0; // Otomatik algılama
        const errorCorrectionLevel = 'L';
        const qr = window.qrcode(typeNumber, errorCorrectionLevel);
        qr.addData(String(text));
        qr.make();
        qrRef.current.innerHTML = qr.createSvgTag({ cellSize: 2, margin: 0 });
        const svg = qrRef.current.querySelector('svg');
        if (svg) {
          svg.style.width = '100%';
          svg.style.height = '100%';
          svg.removeAttribute('width');
          svg.removeAttribute('height');
        }
      } catch (e) {
        console.error("QR Code oluşturulamadı:", text, e);
      }
    }
  }, [text]);

  return <div ref={qrRef} style={{ width: size, height: size, margin: 'auto' }} />;
};

// --- Sabitler ve Veriler ---

const templates = {
  system4: { name: "Barkod Şablonu (Sistem) 4'lü", pageWidth: 210, pageHeight: 297, unit: 'mm', labelWidth: 46, labelHeight: 22, marginTop: 13, marginLeft: 7, numCols: 4, numRows: 13, colGap: 3, rowGap: 0 },
  system3: { name: "Barkod Şablonu (Sistem) 3'lü", pageWidth: 210, pageHeight: 297, unit: 'mm', labelWidth: 69, labelHeight: 25, marginTop: 10, marginLeft: 1.5, numCols: 3, numRows: 11, colGap: 0, rowGap: 0 },
  spine_system: { name: "Sırt Etiketi (Sistem - 52x30mm)", pageWidth: 210, pageHeight: 297, unit: 'mm', labelWidth: 52, labelHeight: 30, marginTop: 0, marginLeft: 20, numCols: 4, numRows: 10, colGap: 0, rowGap: 0 },
  spine_sample: { name: "Sırt Etiketi (Örnek 30x50mm)", pageWidth: 210, pageHeight: 297, unit: 'mm', labelWidth: 30, labelHeight: 50, marginTop: 10, marginLeft: 10, numCols: 6, numRows: 5, colGap: 3, rowGap: 3 },
  custom: { name: 'Özel Ayarlar', pageWidth: 210, pageHeight: 297, unit: 'mm', labelWidth: 46, labelHeight: 22, marginTop: 13, marginLeft: 7, numCols: 4, numRows: 13, colGap: 3, rowGap: 0 },
};

const availableFields = [ 
  { key: 'itemcallnumber', label: 'Yer Numarası' }, 
  { key: 'title', label: 'Başlık' }, 
  { key: 'isbn', label: 'ISBN/ISSN' }, 
  { key: 'author', label: 'Yazar' }, 
  { key: 'homebranch_description', label: 'Ana Kütüphane' }, 
  { key: 'location', label: 'Raf Konumu' },
  { key: 'raf_kontrol_notu', label: 'Raf Kontrol Notu' }
];

const deweyCategories = { 
  '': 'Yer Numarasına Göre Seç...', 
  '0': '000 - Genel Konular', 
  '1': '100 - Felsefe & Psikoloji', 
  '2': '200 - Din', 
  '3': '300 - Toplum Bilimleri', 
  '4': '400 - Dil ve Dil Bilim', 
  '5': '500 - Doğa Bilimleri & Matematik', 
  '6': '600 - Teknoloji', 
  '7': '700 - Sanat', 
  '8': '800 - Edebiyat', 
  '9': '900 - Coğrafya & Tarih' 
};

const settingLabels = {
  pageWidth: 'Sayfa Genişliği',
  pageHeight: 'Sayfa Yüksekliği',
  labelWidth: 'Etiket Genişliği',
  labelHeight: 'Etiket Yüksekliği',
  marginTop: 'Üst Boşluk',
  marginLeft: 'Sol Boşluk',
  numCols: 'Sütun Sayısı',
  numRows: 'Satır Sayısı',
  colGap: 'Sütun Aralığı',
  rowGap: 'Satır Aralığı'
};

// Demo Veri Seti
const demoData = [
    { uniqueId: 'demo-1', barcode: '111000000001', title: 'Suç ve Ceza', author: 'Dostoyevski, Fyodor', itemcallnumber: '891.73 DOS 2020', isbn: '9789750738900', location: 'Yetişkin Bölümü' },
    { uniqueId: 'demo-2', barcode: '111000000002', title: 'Sefiller', author: 'Hugo, Victor', itemcallnumber: '843.8 HUG 2019', isbn: '9789750739901', location: 'Yetişkin Bölümü' },
    { uniqueId: 'demo-3', barcode: '111000000003', title: 'Nutuk', author: 'Atatürk, Mustafa Kemal', itemcallnumber: '956.1 ATA 2018', isbn: '9789750820038', location: 'Atatürk Bölümü' },
    { uniqueId: 'demo-4', barcode: '111000000004', title: 'Küçük Prens', author: 'Saint-Exupéry, Antoine de', itemcallnumber: '843.912 SAI 2021', isbn: '9789750723414', location: 'Çocuk Bölümü' },
    { uniqueId: 'demo-5', barcode: '111000000005', title: 'Simyacı', author: 'Coelho, Paulo', itemcallnumber: '869.3 COE 2017', isbn: '9789750726439', location: 'Yetişkin Bölümü' },
    { uniqueId: 'demo-6', barcode: '111000000006', title: '1984', author: 'Orwell, George', itemcallnumber: '823.912 ORW 2016', isbn: '9789750718533', location: 'Yetişkin Bölümü' },
    { uniqueId: 'demo-7', barcode: '111000000007', title: 'Harry Potter ve Felsefe Taşı', author: 'Rowling, J.K.', itemcallnumber: '823.914 ROW 2015', isbn: '9789750802942', location: 'Gençlik Bölümü' },
    { uniqueId: 'demo-8', barcode: '111000000008', title: 'Kürk Mantolu Madonna', author: 'Ali, Sabahattin', itemcallnumber: '813.42 ALI 2022', isbn: '9789750806636', location: 'Yetişkin Bölümü' },
    { uniqueId: 'demo-9', barcode: '111000000009', title: 'Beyaz Diş', author: 'London, Jack', itemcallnumber: '813.52 LON 2014', isbn: '9789754587404', location: 'Çocuk Bölümü' },
    { uniqueId: 'demo-10', barcode: '111000000010', title: 'Fareler ve İnsanlar', author: 'Steinbeck, John', itemcallnumber: '813.52 STE 2013', isbn: '9789755705859', location: 'Yetişkin Bölümü' },
];

// --- Ana Uygulama ---

function App() {
  // 1. Bağımlılıkları Yükle
  const { loaded, error } = useScriptLoader([
    "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"
  ]);

  // 2. State Tanımları
  const [user, setUser] = useState(null);
  const [allData, setAllData] = useState([]); 
  const [fileName, setFileName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedBarcodes, setSelectedBarcodes] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [settings, setSettings] = useState(templates.system4);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('system4');
  const [sortConfig, setSortConfig] = useState({ key: 'barcode', direction: 'ascending' });
  const [pdfFileName, setPdfFileName] = useState('etiketler');
  
  const [rowsPerPageOption, setRowsPerPageOption] = useState('default'); 
  const [fileEncoding, setFileEncoding] = useState('Windows-1254'); 
  const [labelType, setLabelType] = useState('barcode');
  const [labelFields, setLabelFields] = useState(['itemcallnumber', 'title']);
  const [textAlign, setTextAlign] = useState('center'); 
  const [fontSize, setFontSize] = useState(8);
  const [logo, setLogo] = useState('https://i.ibb.co/XrrDKnNW/ktblogo400.png');
  const [useMinistryLogo, setUseMinistryLogo] = useState(true);
  const [logoSize, setLogoSize] = useState(7);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [customTemplates, setCustomTemplates] = useState({});
  const [newTemplateName, setNewTemplateName] = useState("");
  const [startBarcode, setStartBarcode] = useState("");
  const [endBarcode, setEndBarcode] = useState("");
  const [barcodeFormat, setBarcodeFormat] = useState('CODE128');
  const [barcodeHeight, setBarcodeHeight] = useState(35); 
  const [fontFamily, setFontFamily] = useState('sans-serif');
  const [isFirstLineBold, setIsFirstLineBold] = useState(true);
  const [customText, setCustomText] = useState("");

  const [showSpineBarcode, setShowSpineBarcode] = useState(false);
  const [spineBarcodePosition, setSpineBarcodePosition] = useState('bottom'); 
  const [spineBarcodeFontSize, setSpineBarcodeFontSize] = useState(8);
  const [spineBarcodeBold, setSpineBarcodeBold] = useState(true);
  const [spineMainTextBold, setSpineMainTextBold] = useState(true); 
  const [spineTextVerticalShift, setSpineTextVerticalShift] = useState(0);

  const tableHeaders = [ 
    { key: 'barcode', label: 'Barkod' }, 
    { key: 'title', label: 'Eser Adı' }, 
    { key: 'author', label: 'Yazar' }, 
    { key: 'itemcallnumber', label: 'Yer Numarası' }, 
    { key: 'isbn', label: 'ISBN/ISSN' },
    { key: 'location', label: 'Raf Konumu' }
  ];

  // --- Firebase Auth ve Veri Yükleme ---
  useEffect(() => {
    const initAuth = async () => {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        try {
          const saved = localStorage.getItem('kohaLabelMaker_customTemplates');
          if (saved) setCustomTemplates(JSON.parse(saved));
        } catch (e) { console.error("Yerel şablonlar yüklenemedi", e); }
      }
    });
    return () => unsubscribe();
  }, []);

  // Kullanıcı değiştiğinde Firestore'dan verileri çek
  useEffect(() => {
    if (!user) return;

    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'user_data', 'templates');
    const unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            setCustomTemplates(docSnap.data());
        } else {
            setCustomTemplates({});
        }
    }, (error) => {
        console.error("Firestore veri çekme hatası:", error);
    });

    return () => unsubscribeSnapshot();
  }, [user]);

  // --- Hesap İşlemleri ---
  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Google giriş hatası:", error);
      alert("Giriş yapılırken bir hata oluştu.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      const saved = localStorage.getItem('kohaLabelMaker_customTemplates');
      if (saved) setCustomTemplates(JSON.parse(saved));
      else setCustomTemplates({});
    } catch (error) {
      console.error("Çıkış hatası:", error);
    }
  };
  
  const itemsPerPage = useMemo(() => {
    if (allData.length === 0) return Math.max(1, settings.numCols * settings.numRows);
    if (rowsPerPageOption === 'all') return 999999; 
    if (rowsPerPageOption === 'default') return Math.max(1, settings.numCols * settings.numRows);
    return Number(rowsPerPageOption);
  }, [rowsPerPageOption, settings.numCols, settings.numRows, allData.length]);

  // --- Effects ---
  useEffect(() => { 
    document.documentElement.classList.toggle('dark', isDarkMode); 
  }, [isDarkMode]);

  // Başlangıçta demo veri yükle
  useEffect(() => {
      setAllData(demoData);
      setFileName("Örnek Veri Seti");
      const demoSelection = new Set(demoData.slice(0, 5).map(d => d.barcode));
      setSelectedBarcodes(demoSelection);
  }, []);

  useEffect(() => {
      if (labelType === 'spine') {
          setTextAlign('center');
          setFontSize(12); 
      } else {
          setTextAlign('left');
          setFontSize(8);
      }
  }, [labelType]);

  // Seçimleri oturumda tut
  useEffect(() => {
    try {
      const savedSelection = sessionStorage.getItem('kohaLabelMaker_selectedBarcodes');
      if (savedSelection && savedSelection !== '[]') {
         // setSelectedBarcodes(new Set(JSON.parse(savedSelection)));
      }
    } catch(e) { console.error("Seçimler yüklenemedi", e); }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem('kohaLabelMaker_selectedBarcodes', JSON.stringify(Array.from(selectedBarcodes)));
    } catch (e) { console.error("Seçimler kaydedilemedi", e); }
  }, [selectedBarcodes]);

  const labelsToPrint = useMemo(() => 
    allData.filter(item => selectedBarcodes.has(item.barcode)).sort((a, b) => a.barcode.localeCompare(b.barcode)), 
  [allData, selectedBarcodes]);

  const filteredData = useMemo(() => 
    allData.filter(item => Object.values(item).some(val => String(val).toLowerCase().includes(searchTerm.toLowerCase()))), 
  [allData, searchTerm]);

  const sortedData = useMemo(() => {
    let sortableItems = [...filteredData];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        const valA = a[sortConfig.key] || ''; 
        const valB = b[sortConfig.key] || '';
        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortConfig.direction === 'ascending' 
            ? valA.localeCompare(valB, undefined, {numeric: true}) 
            : valB.localeCompare(valA, undefined, {numeric: true});
        }
        if (valA < valB) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredData, sortConfig]);

  const effectiveItemsPerPage = useMemo(() => {
      if (rowsPerPageOption === 'all') return Math.max(1, sortedData.length);
      return itemsPerPage;
  }, [itemsPerPage, rowsPerPageOption, sortedData.length]);

  const paginatedData = useMemo(() => { 
    const startIndex = (currentPage - 1) * effectiveItemsPerPage; 
    return sortedData.slice(startIndex, startIndex + effectiveItemsPerPage); 
  }, [sortedData, currentPage, effectiveItemsPerPage]);

  const isCurrentPageSelected = useMemo(() => {
    return paginatedData.length > 0 && paginatedData.every(item => selectedBarcodes.has(item.barcode));
  }, [paginatedData, selectedBarcodes]);

  const uniqueLocations = useMemo(() => 
    Array.from(new Set(allData.map(item => item.location).filter(Boolean))).sort(), 
  [allData]);

  const handlePrintAsPdf = useCallback(() => {
    const printArea = document.getElementById('print-area');
    if (!window.jspdf || !window.html2canvas) {
        alert("PDF kütüphaneleri henüz yüklenmedi. Lütfen sayfayı yenileyin veya biraz bekleyin.");
        return;
    }
    
    const { jsPDF } = window.jspdf;
    if (printArea) {
      window.html2canvas(printArea, { scale: 3, useCORS: true, logging: false }).then(canvas => {
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        
        const baseFileName = pdfFileName.trim() || 'etiketler';
        const dt = new Date();
        const dateTimeString = `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}_${String(dt.getHours()).padStart(2,'0')}${String(dt.getMinutes()).padStart(2,'0')}`;
        pdf.save(`${baseFileName}_${dateTimeString}.pdf`);
      }).catch(err => {
        console.error("PDF oluşturma hatası:", err);
        alert("PDF oluşturulurken bir hata oluştu. Detaylar konsolda.");
      });
    }
  }, [pdfFileName]);

  const updateSelection = (barcodesToUpdate, shouldSelect) => { 
    setSelectedBarcodes(prev => { 
      const newSet = new Set(prev); 
      barcodesToUpdate.forEach(b => { 
        if (shouldSelect) newSet.add(b); 
        else newSet.delete(b); 
      }); 
      return newSet; 
    }); 
  };

  const handleHeaderCheckboxChange = (e) => {
    const barcodesOnPage = paginatedData.map(item => item.barcode);
    updateSelection(barcodesOnPage, e.target.checked);
  };

  const handleSelectAllFiltered = useCallback(() => updateSelection(filteredData.map(item => item.barcode), true), [filteredData]);
  const handleDeselectAllFiltered = useCallback(() => updateSelection(filteredData.map(item => item.barcode), false), [filteredData]);
  
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); handlePrintAsPdf(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); handleSelectAllFiltered(); }
      if (e.key === 'Escape') { e.preventDefault(); handleDeselectAllFiltered(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrintAsPdf, handleSelectAllFiltered, handleDeselectAllFiltered]);

  const findColumnKey = (row, candidates) => {
    const keys = Object.keys(row);
    for (const candidate of candidates) {
      const found = keys.find(k => k.trim().toLowerCase() === candidate.toLowerCase());
      if (found) return found;
    }
    return null;
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0]; if (!file) return;
    setFileName(file.name); setErrorMessage(''); setAllData([]); setSelectedBarcodes(new Set());
    
    const processData = (data) => { 
        const normalizedData = data.map(row => {
            const newRow = {};
            Object.keys(row).forEach(key => {
                newRow[key.trim()] = row[key]; 
            });
            return newRow;
        });

        const mappedData = normalizedData
            .filter(row => findColumnKey(row, ['barkod', 'barcode'])) 
            .map((row, index) => {
                const barcodeKey = findColumnKey(row, ['barkod', 'barcode']);
                const titleKey = findColumnKey(row, ['eser adı', 'title', 'başlık', 'kitap adı']);
                const authorKey = findColumnKey(row, ['yazar', 'author']);
                const callNumKey = findColumnKey(row, ['yer numarası', 'itemcallnumber', 'callnumber', 'yer no']);
                const isbnKey = findColumnKey(row, ['isbn/issn', 'isbn', 'issn']);
                const branchKey = findColumnKey(row, ['ana kütüphane', 'homebranch', 'kütüphane']);
                const locationKey = findColumnKey(row, ['raf konumu', 'location', 'konum']);
                const noteKey = findColumnKey(row, ['raf kontrol notu', 'note']);
                const typeKey = findColumnKey(row, ['materyal türü', 'itemtype', 'tür']);

                return {
                    ...row,
                    uniqueId: `row-${index}-${Math.random().toString(36).substr(2, 9)}`,
                    barcode: barcodeKey ? String(row[barcodeKey]).trim() : '',
                    title: titleKey ? String(row[titleKey]) : '',
                    author: authorKey ? String(row[authorKey]) : '',
                    itemcallnumber: callNumKey ? String(row[callNumKey]) : '',
                    isbn: isbnKey ? String(row[isbnKey]) : '',
                    homebranch_description: branchKey ? String(row[branchKey]) : '',
                    location: locationKey ? String(row[locationKey]) : '',
                    raf_kontrol_notu: noteKey ? String(row[noteKey]) : '',
                    itemtype: typeKey ? String(row[typeKey]) : ''
                };
            });

        if (mappedData.length > 0) { 
            setAllData(mappedData); 
        } else { 
            setErrorMessage('Dosyada "Barkod" sütunu bulunamadı veya okunamadı. Lütfen dosya kodlamasını kontrol edin.'); 
        } 
    };

    if (file.name.endsWith('.csv')) { 
        if(window.Papa) {
            window.Papa.parse(file, { 
                header: true, 
                skipEmptyLines: true, 
                encoding: fileEncoding, 
                complete: res => processData(res.data) 
            }); 
        } else {
            alert("CSV işleyici (PapaParse) henüz yüklenmedi.");
        }
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        if(window.XLSX) {
            const reader = new FileReader();
            reader.onload = (e) => { 
                const wb = window.XLSX.read(e.target.result, { type: 'binary' }); 
                processData(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])); 
            };
            reader.readAsBinaryString(file);
        } else {
            alert("Excel işleyici (SheetJS) henüz yüklenmedi.");
        }
    } else { 
        setErrorMessage('Desteklenmeyen dosya türü. Lütfen .csv veya .xlsx dosyası yükleyin.'); 
    }
  };

  const handleLoadDemoData = () => {
      setAllData(demoData);
      setFileName("Örnek Veri Seti");
      const demoSelection = new Set(demoData.map(d => d.barcode));
      setSelectedBarcodes(demoSelection);
      setErrorMessage('');
  };
  
  const handleFieldSelection = (e) => {
    const { value, checked } = e.target;
    setLabelFields(prev => {
        if (checked) { return prev.length < 3 ? [...prev, value] : prev; } 
        else { return prev.filter(field => field !== value); }
    });
  };

  const handleSelectByRange = () => {
    if (!startBarcode || !endBarcode) { alert("Lütfen başlangıç ve bitiş barkodlarını girin."); return; }
    const barcodesToSelect = allData.filter(item => item.barcode.localeCompare(startBarcode) >= 0 && item.barcode.localeCompare(endBarcode) <= 0).map(item => item.barcode);
    updateSelection(barcodesToSelect, true);
    alert(`${barcodesToSelect.length} adet materyal seçildi.`);
  };
  
  // --- Şablon Kaydetme (Firestore + LocalStorage) ---
  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim()) { alert("Lütfen şablon için bir isim girin."); return; }
    
    const newTemplates = { ...customTemplates, [newTemplateName]: settings };
    setCustomTemplates(newTemplates);
    
    if (user) {
        // Kullanıcı giriş yapmışsa Firestore'a kaydet
        try {
            await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'user_data', 'templates'), newTemplates);
        } catch (e) {
            console.error("Şablon kaydedilemedi (Cloud):", e);
            alert("Şablon buluta kaydedilemedi.");
        }
    } else {
        // Giriş yapmamışsa LocalStorage'a kaydet
        localStorage.setItem('kohaLabelMaker_customTemplates', JSON.stringify(newTemplates));
    }
    setNewTemplateName('');
  };

  const handleDeleteTemplate = async (templateName) => {
    const newTemplates = { ...customTemplates };
    delete newTemplates[templateName];
    setCustomTemplates(newTemplates);
    
    if (user) {
         try {
            await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'user_data', 'templates'), newTemplates);
        } catch (e) {
            console.error("Şablon silinemedi (Cloud):", e);
        }
    } else {
        localStorage.setItem('kohaLabelMaker_customTemplates', JSON.stringify(newTemplates));
    }
  };
  
  const loadTemplate = (key) => { 
      setSelectedTemplateKey(key); 
      if (key !== 'custom' && key !== 'load_custom') {
          const tmpl = templates[key] || customTemplates[key];
          if(tmpl) setSettings(tmpl);
      }
  };

  const handleSettingChange = (field, value) => { 
      const newSettings = { ...settings, [field]: Number(value) }; 
      setSettings(newSettings); 
      setSelectedTemplateKey('custom'); 
      templates.custom = { ...templates.custom, ...newSettings }; 
  };

  const requestSort = (key) => { 
      setSortConfig(c => ({ key, direction: c.key === key && c.direction === 'ascending' ? 'descending' : 'ascending' })); 
      setCurrentPage(1); 
  };
  
  const handleSelectPage = () => updateSelection(paginatedData.map(item => item.barcode), true);
  const handleDeselectPage = () => updateSelection(paginatedData.map(item => item.barcode), false);
  
  const handleLocationSelect = (e) => { 
      const loc = e.target.value; 
      if (!loc) return; 
      updateSelection(allData.filter(i => i.location === loc).map(i => i.barcode), true); 
      e.target.value = ''; 
  };
  
  const handleDeweySelect = (e) => { 
      const prefix = e.target.value; 
      if (!prefix) return; 
      updateSelection(allData.filter(i => i.itemcallnumber && String(i.itemcallnumber).startsWith(prefix)).map(i => i.barcode), true); 
      e.target.value = ''; 
  };
  
  const handleLogoChange = (e) => { 
      const file = e.target.files[0]; 
      if (file) { 
          const reader = new FileReader(); 
          reader.onload = (ev) => { setLogo(ev.target.result); setUseMinistryLogo(false); }; 
          reader.readAsDataURL(file); 
      }
  };
  
  const handleMinistryLogoToggle = (e) => { 
      setUseMinistryLogo(e.target.checked); 
      setLogo(e.target.checked ? 'https://i.ibb.co/XrrDKnNW/ktblogo400.png' : null); 
  };

  // 6. Render Yardımcıları
  const renderSingleLabel = (data, key) => {
    if (labelType === 'spine') {
      const callNumber = data.itemcallnumber || (key === 'preview' ? '398.27 GRİ 2005' : '');
      const parts = callNumber.split(' ').filter(p => p && p.trim().length > 0);
      
      let barcodeDisplay = null;
      if (showSpineBarcode) {
          let bCode = data.barcode || (key === 'preview' ? '111000000072' : '');
          if (bCode.length > 4) {
              bCode = bCode.substring(4);
          }
          bCode = bCode.replace(/^0+/, '');
          if(bCode) barcodeDisplay = `[${bCode}]`;
      }

      return (
        <div className="flex flex-col items-center justify-start h-full w-full overflow-hidden" 
             style={{ 
               fontFamily: fontFamily, 
               fontSize: `${fontSize}pt`, 
               lineHeight: '1', 
               textAlign: textAlign,
               padding: '0mm', 
               paddingBottom: '0.5mm',
               paddingLeft: '1mm',
               paddingRight: '1mm'
             }}>
            {spineBarcodePosition === 'top' && barcodeDisplay && (
                <div className="font-mono leading-none" style={{fontSize: `${spineBarcodeFontSize}pt`, fontWeight: spineBarcodeBold ? 'bold' : 'normal', marginBottom: '0.5mm'}}>{barcodeDisplay}</div>
            )}
            
            <div style={{ transform: `translateY(${spineTextVerticalShift}mm)` }} className="w-full">
                {parts.length > 0 ? parts.map((part, index) => (
                <div key={index} className="w-full break-words leading-none" style={{ fontWeight: spineMainTextBold ? 'bold' : 'normal', marginBottom: '0.5mm' }}>
                    {part}
                </div>
                )) : (
                <div className="text-slate-300 text-xs italic">Yer No Yok</div>
                )}
            </div>
            
            {spineBarcodePosition === 'bottom' && barcodeDisplay && (
                <div className="mt-0.5 font-mono leading-none" style={{fontSize: `${spineBarcodeFontSize}pt`, fontWeight: spineBarcodeBold ? 'bold' : 'normal'}}>{barcodeDisplay}</div>
            )}
        </div>
      );
    }

    return (
      <div className="flex flex-col text-black h-full box-border overflow-hidden relative bg-white">
          <div className="flex items-start flex-grow overflow-hidden relative z-0" style={{ paddingTop: '1mm', paddingLeft: '1mm', paddingRight: '1mm' }}>
              {logo && (
                  <img 
                      src={logo} 
                      alt="logo" 
                      className="flex-shrink-0 object-contain" 
                      style={{ height: `${logoSize}mm`, width: 'auto', marginRight: '2mm' }} 
                  />
              )}
              <div className="flex-grow overflow-hidden" style={{ textAlign: textAlign, fontSize: `${fontSize}pt`, lineHeight: '1.2', fontFamily: fontFamily }}>
                  {labelFields.map((fieldKey, index) => {
                      const content = fieldKey === 'customText' 
                          ? customText 
                          : (data?.[fieldKey] || ''); 

                      if (!content && key !== 'preview') return null; 

                      return (
                          <span key={`${fieldKey}-${index}`} className={`max-w-full block ${index === 0 && isFirstLineBold ? 'font-bold' : ''}`} style={{wordBreak: 'break-word'}}>
                              {content || (key === 'preview' ? `[${fieldKey}]` : '')}
                          </span>
                      );
                  })}
              </div>
          </div>
          <div className="mt-auto flex-shrink-0 w-full flex justify-center items-end bg-white relative z-10" style={{ padding: '1mm 1mm 1mm 1mm' }}>
              {barcodeFormat === 'CODE128' 
                  ? <Barcode text={data?.barcode || '123456789012'} height={barcodeHeight} /> 
                  : <QRCode text={data?.barcode || '123456789012'} size={`${Math.min(settings.labelWidth * 0.8, settings.labelHeight * 0.6)}mm`} />
              }
          </div>
      </div>
    );
  };

  const renderLabels = () => {
    const totalSlots = settings.numCols * settings.numRows;
    return Array.from({ length: totalSlots }).map((_, i) => (
        <div key={`label-${i}`} className="border border-dashed border-gray-300 overflow-hidden box-border bg-white" style={{ height: '100%' }}>
            {labelsToPrint[i] ? renderSingleLabel(labelsToPrint[i], i) : null}
        </div>
    ));
  };
  
  const paginationControls = (
    <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-4 text-sm bg-slate-50 dark:bg-slate-700/50 p-2 rounded-lg border border-slate-200 dark:border-slate-600">
        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-4 py-2 border rounded-md bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-800 dark:border-slate-600 dark:hover:bg-slate-700 transition-colors">« Önceki</button>
        
        <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-6">
            <span className="font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
                Sayfa {currentPage} / {Math.max(1, Math.ceil(sortedData.length / effectiveItemsPerPage))} 
                <span className="ml-2 text-slate-400 dark:text-slate-500 hidden sm:inline">(Top. {sortedData.length})</span>
            </span>

            <div className="flex items-center gap-2 border-l pl-4 border-slate-300 dark:border-slate-600">
                <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">Göster:</span>
                <select 
                    value={rowsPerPageOption} 
                    onChange={(e) => { setRowsPerPageOption(e.target.value); setCurrentPage(1); }} 
                    className="p-1.5 border rounded-md text-xs bg-white dark:bg-slate-600 dark:border-slate-500 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer"
                >
                    <option value="default">Otomatik ({settings.numCols * settings.numRows})</option>
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="all">Tümü</option>
                </select>
            </div>
        </div>

        <button onClick={() => setCurrentPage(p => Math.min(Math.ceil(sortedData.length / effectiveItemsPerPage), p + 1))} disabled={currentPage * effectiveItemsPerPage >= sortedData.length} className="px-4 py-2 border rounded-md bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-slate-800 dark:border-slate-600 dark:hover:bg-slate-700 transition-colors">Sonraki »</button>
    </div>
  );

  if (!loaded) {
      return (
          <div className="flex items-center justify-center min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300">
              <div className="text-center">
                  <h2 className="text-2xl font-bold mb-2">Uygulama Hazırlanıyor...</h2>
                  <p>Gerekli kütüphaneler yükleniyor.</p>
                  {error && <p className="text-red-500 mt-4">{error}</p>}
                  <div className="mt-4 animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              </div>
          </div>
      );
  }

  return (
    <>
      <style>{`
        .no-print { display: block; } 
        #print-area { display: block; } 
        @media print { 
            body * { visibility: hidden; } 
            .no-print { display: none; } 
            #print-area, #print-area * { visibility: visible; } 
            #print-area { position: absolute; left: 0; top: 0; width: 100% !important; height: 100% !important; padding: 0 !important; margin: 0 !important; box-shadow: none !important; border: none !important; transform: none !important; } 
        }
      `}</style>
      <div className="bg-slate-100 dark:bg-slate-900 min-h-screen text-slate-800 dark:text-slate-200 font-sans p-4 sm:p-6 lg:p-8 transition-colors duration-200">
        <div className="max-w-screen-2xl mx-auto">
           <header className="mb-8 no-print flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Kütüphane Etiket Oluşturucu</h1>
                    <p className="text-slate-600 dark:text-slate-400 mt-1">Koha veya Excel verilerini yükleyin, barkod veya sırt etiketlerini tasarlayın.</p>
                </div>
                
                {/* --- KULLANICI MENÜSÜ --- */}
                <div className="flex items-center gap-4">
                    {user ? (
                        <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-2 rounded-full shadow-sm border border-slate-200 dark:border-slate-700 pr-4">
                            {user.photoURL ? (
                                <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 rounded-full" />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold text-sm">
                                    {user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
                                </div>
                            )}
                            <div className="hidden sm:block">
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{user.displayName}</p>
                                <p className="text-[10px] text-emerald-500">● Çevrimiçi</p>
                            </div>
                            <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-600 font-semibold ml-2">Çıkış</button>
                        </div>
                    ) : (
                        <button onClick={handleGoogleLogin} className="flex items-center gap-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-full shadow-sm border border-slate-200 dark:border-slate-700 transition-all font-medium text-sm">
                            <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26z" /><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                            Giriş Yap
                        </button>
                    )}
                    <button onClick={() => setIsDarkMode(p => !p)} className="p-2.5 rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">
                        {isDarkMode ? '☀️' : '🌙'}
                    </button>
                </div>
            </header>
          
          <div className="flex flex-col gap-8">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm no-print border border-slate-200 dark:border-slate-700">
                <h3 className="font-bold text-lg border-b pb-3 mb-4 dark:border-slate-600 flex items-center gap-2">
                    <span className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs px-2 py-1 rounded-full">Adım 1</span>
                    Veri Dosyası Yükle
                </h3>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-800 rounded-lg">
                         <div className="flex-grow">
                            <label className="block text-sm font-semibold text-yellow-800 dark:text-yellow-300 mb-1">Karakter Kodlaması</label>
                            <p className="text-xs text-slate-600 dark:text-slate-400">Dosyanızdaki Türkçe karakterler bozuk çıkıyorsa veya sütunlar bulunamıyorsa buradan ayarı değiştirip dosyayı tekrar seçin.</p>
                         </div>
                         <select 
                            value={fileEncoding} 
                            onChange={(e) => setFileEncoding(e.target.value)} 
                            className="p-2 border rounded text-sm bg-white dark:bg-slate-800 dark:border-slate-600 cursor-pointer min-w-[200px]"
                         >
                            <option value="Windows-1254">Türkçe (Windows-1254) - Önerilen</option>
                            <option value="UTF-8">UTF-8 (Standart)</option>
                            <option value="ISO-8859-9">Türkçe (ISO-8859-9)</option>
                         </select>
                    </div>

                    <div className="flex items-center gap-4 flex-wrap">
                        <label className="block flex-grow">
                            <span className="sr-only">Dosya Seç</span>
                            <input type="file" accept=".csv, .xlsx, .xls" onChange={handleFileChange} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-300 cursor-pointer"/>
                        </label>
                        <button onClick={handleLoadDemoData} className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-full text-sm font-semibold transition-colors whitespace-nowrap border border-slate-300 dark:border-slate-600">
                            Örnek Veri Yükle
                        </button>
                    </div>
                </div>
                {fileName && <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-3 font-medium">✓ Yüklendi: {fileName} ({allData.length} kayıt)</p>}
                {errorMessage && <p className="text-sm text-red-500 mt-3 font-medium">⚠️ {errorMessage}</p>}
            </div>

            {allData.length > 0 && (
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm no-print border border-slate-200 dark:border-slate-700">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b pb-3 mb-4 dark:border-slate-600 gap-2">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        <span className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs px-2 py-1 rounded-full">Adım 2</span>
                        Materyal Seçimi <span className="text-sm font-normal text-slate-500 ml-2">({selectedBarcodes.size} adet seçildi)</span>
                    </h3>
                </div>

                {/* GÖSTERİM SAYISI SEÇİMİ */}
                <div className="flex justify-end mb-4">
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Listeleme:</label>
                        <select 
                            value={rowsPerPageOption} 
                            onChange={(e) => { setRowsPerPageOption(e.target.value); setCurrentPage(1); }} 
                            className="p-1.5 border rounded-md text-sm bg-white dark:bg-slate-700 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                        >
                            <option value="default">Sayfa Düzenine Göre ({settings.numCols * settings.numRows})</option>
                            <option value="10">10 Kayıt</option>
                            <option value="25">25 Kayıt</option>
                            <option value="50">50 Kayıt</option>
                            <option value="100">100 Kayıt</option>
                            <option value="all">Tümü ({sortedData.length})</option>
                        </select>
                    </div>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    <div className="bg-slate-50 dark:bg-slate-700/30 p-4 rounded-lg">
                        <h4 className="font-semibold text-sm mb-3 text-slate-700 dark:text-slate-300">Barkod Aralığına Göre Seç</h4>
                        <div className="flex items-center gap-2">
                           <input type="text" placeholder="Başlangıç (Örn: 001)" value={startBarcode} onChange={e => setStartBarcode(e.target.value)} className="w-full p-2 border rounded-md text-sm dark:bg-slate-700 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 outline-none" />
                           <span className="text-slate-400">-</span>
                           <input type="text" placeholder="Bitiş (Örn: 050)" value={endBarcode} onChange={e => setEndBarcode(e.target.value)} className="w-full p-2 border rounded-md text-sm dark:bg-slate-700 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 outline-none" />
                           <button onClick={handleSelectByRange} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors">Seç</button>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-700/30 p-4 rounded-lg">
                        <h4 className="font-semibold text-sm mb-3 text-slate-700 dark:text-slate-300">Gruplara Göre Hızlı Seç</h4>
                        <div className="flex items-center gap-3">
                           <select defaultValue="" onChange={handleLocationSelect} className="w-full p-2 border rounded-md text-sm bg-white dark:bg-slate-700 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 outline-none" disabled={uniqueLocations.length === 0}>
                                <option value="">Kütüphane Bölümü...</option>
                                {uniqueLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                           </select>
                           <select defaultValue="" onChange={handleDeweySelect} className="w-full p-2 border rounded-md text-sm bg-white dark:bg-slate-700 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 outline-none">
                                <option value="">Dewey Sınıflaması...</option>
                                {Object.entries(deweyCategories).map(([key, value]) => key && <option key={key} value={key}>{value}</option>)}
                           </select>
                        </div>
                    </div>
                </div>

                 <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-900/30">
                   <div className="flex items-center gap-2">
                       <span className="text-xs font-bold text-blue-800 dark:text-blue-300 mr-2">TOPLU İŞLEMLER:</span>
                       <button onClick={handleSelectAllFiltered} className="px-3 py-1.5 bg-white border border-blue-200 rounded text-sm text-blue-700 hover:bg-blue-50 dark:bg-slate-800 dark:border-slate-600 dark:text-blue-300 dark:hover:bg-slate-700 transition-colors">Listelenenleri Seç</button>
                       <button onClick={handleDeselectAllFiltered} className="px-3 py-1.5 bg-white border border-red-200 rounded text-sm text-red-600 hover:bg-red-50 dark:bg-slate-800 dark:border-slate-600 dark:text-red-400 dark:hover:bg-slate-700 transition-colors">Seçimi Kaldır</button>
                   </div>
                   <div className="flex items-center gap-2">
                       <button onClick={handleSelectPage} className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors">Bu Sayfayı Seç</button>
                       <button onClick={handleDeselectPage} className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-700 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors">Bu Sayfayı Kaldır</button>
                   </div>
                </div>

                <div className="relative mb-3">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
                    <input type="text" placeholder="Başlık, yazar, barkod veya yer numarası ara..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} className="w-full pl-9 p-2.5 border rounded-md text-sm shadow-sm dark:bg-slate-700 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>

                {/* ÜST SAYFALAMA BUTONLARI */}
                {paginationControls}

                <div className="overflow-x-auto border rounded-lg dark:border-slate-700 mt-2">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 font-semibold">
                                {/* BAŞLIK CHECKBOX */}
                                <th className="p-3 w-10">
                                  <input 
                                      type="checkbox" 
                                      checked={isCurrentPageSelected} 
                                      onChange={handleHeaderCheckboxChange}
                                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-500 cursor-pointer"
                                  />
                                </th>
                                {/* Yeni eklenen Sıra No başlığı */}
                                <th className="p-3 w-10 font-bold text-center text-slate-500">#</th>
                                
                                {tableHeaders.map((header, idx) => (
                                    <th key={idx} className="p-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 select-none transition-colors" onClick={() => idx > 0 && requestSort(header.key)}>
                                        <div className="flex items-center gap-1">
                                            {header.label || ''}
                                            {idx > 0 && sortConfig.key === header.key && <span className="text-blue-500">{sortConfig.direction === 'ascending' ? '▲' : '▼'}</span>}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y dark:divide-slate-700">
                            {paginatedData.map((item, index) => (
                                <tr key={item.uniqueId || index} className={`hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors ${selectedBarcodes.has(item.barcode) ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}>
                                    <td className="p-3 w-10">
                                        <input type="checkbox" checked={selectedBarcodes.has(item.barcode)} onChange={(e) => updateSelection([item.barcode], e.target.checked)} className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 dark:bg-slate-800 dark:border-slate-500 cursor-pointer"/>
                                    </td>
                                    {/* Yeni eklenen Sıra No hücresi */}
                                    <td className="p-3 w-10 text-center font-mono text-xs text-slate-400">
                                        {(currentPage - 1) * effectiveItemsPerPage + index + 1}
                                    </td>
                                    {tableHeaders.map(header => (
                                        <td key={`${item.uniqueId}-${header.key}`} className={`p-3 ${header.key === 'barcode' ? 'font-mono text-slate-600 dark:text-slate-400' : ''} ${header.key === 'title' ? 'font-medium text-slate-900 dark:text-white' : ''}`}>
                                            {item[header.key]}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            {paginatedData.length === 0 && (
                                <tr><td colSpan={tableHeaders.length + 2} className="p-8 text-center text-slate-500">Kayıt bulunamadı.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                
                {/* ALT SAYFALAMA BUTONLARI (Mevcut olan, yukarıdakinin aynısı) */}
                {paginationControls}
            </div>
            )}
            
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm no-print border border-slate-200 dark:border-slate-700">
                <h3 className="font-bold text-lg border-b pb-3 mb-4 dark:border-slate-600 flex items-center gap-2">
                    <span className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs px-2 py-1 rounded-full">Adım 3</span>
                    Etiket ve Baskı Ayarları
                </h3>
                
                <div className="mb-6 bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-lg border border-indigo-100 dark:border-indigo-800">
                    <h4 className="font-semibold text-sm mb-3 text-indigo-900 dark:text-indigo-300">Etiket Türü Seçimi</h4>
                    <div className="flex gap-4">
                        <label className={`flex-1 cursor-pointer p-3 rounded-lg border-2 transition-all text-center ${labelType === 'barcode' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 hover:border-blue-300 bg-white dark:bg-slate-800 dark:border-slate-600'}`}>
                            <input type="radio" name="labelType" value="barcode" checked={labelType === 'barcode'} onChange={() => setLabelType('barcode')} className="sr-only" />
                            <div className="font-bold text-sm">Barkod Etiketi</div>
                            <div className="text-xs text-slate-500 mt-1">Barkod, başlık ve yazar içerir.</div>
                        </label>
                        <label className={`flex-1 cursor-pointer p-3 rounded-lg border-2 transition-all text-center ${labelType === 'spine' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 hover:border-blue-300 bg-white dark:bg-slate-800 dark:border-slate-600'}`}>
                            <input type="radio" name="labelType" value="spine" checked={labelType === 'spine'} onChange={() => setLabelType('spine')} className="sr-only" />
                            <div className="font-bold text-sm">Sırt Etiketi</div>
                            <div className="text-xs text-slate-500 mt-1">Sadece yer numarası alt alta yazılır.</div>
                        </label>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        {/* BARKOD MODU AYARLARI */}
                        {labelType === 'barcode' && (
                        <div className="bg-slate-50 dark:bg-slate-700/30 p-4 rounded-lg">
                            <h4 className="font-semibold text-sm mb-3 flex justify-between">
                                Etiket Üzerindeki Bilgiler
                                <span className="text-xs font-normal text-slate-500 bg-white dark:bg-slate-800 px-2 py-0.5 rounded border dark:border-slate-600">Max 3 satır</span>
                            </h4>
                            <div className="grid grid-cols-2 gap-3 mb-4">
                              {availableFields.map(field => ( 
                                  <label key={field.key} className={`flex items-center space-x-2 text-sm p-2 rounded border transition-all cursor-pointer ${labelFields.includes(field.key) ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800' : 'border-transparent hover:bg-white dark:hover:bg-slate-600'}`}>
                                      <input type="checkbox" value={field.key} checked={labelFields.includes(field.key)} onChange={handleFieldSelection} disabled={!labelFields.includes(field.key) && labelFields.length >= 3} className="rounded text-blue-600 focus:ring-blue-500"/>
                                      <span className="truncate">{field.label}</span>
                                  </label>
                              ))}
                              
                              <div className="col-span-2 mt-2 pt-3 border-t dark:border-slate-600">
                                  <label className="flex items-center space-x-2 text-sm cursor-pointer mb-2">
                                      <input type="checkbox" value="customText" checked={labelFields.includes('customText')} onChange={handleFieldSelection} disabled={!labelFields.includes('customText') && labelFields.length >= 3} className="rounded text-blue-600 focus:ring-blue-500"/>
                                      <span className="font-medium">Sabit Metin Ekle</span>
                                  </label>
                                  {labelFields.includes('customText') && (
                                      <input type="text" value={customText} onChange={e => setCustomText(e.target.value)} placeholder="Örn: Kütüphane Adı" className="w-full p-2 border rounded-md text-sm dark:bg-slate-700 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 outline-none"/>
                                  )}
                              </div>
                            </div>
                        </div>
                        )}

                        <div className="grid md:grid-cols-2 gap-6">
                            <div>
                                <h4 className="font-semibold text-sm mb-3">Yazı Stili</h4>
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-xs font-medium block mb-1 text-slate-500">Hizalama</label>
                                            <select value={textAlign} onChange={(e) => setTextAlign(e.target.value)} className="w-full p-2 border rounded-md text-sm dark:bg-slate-700 dark:border-slate-600"><option value="left">Sola</option><option value="center">Orta</option><option value="right">Sağa</option></select>
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium block mb-1 text-slate-500">Boyut (pt)</label>
                                            <input type="number" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full p-2 border rounded-md text-sm dark:bg-slate-700 dark:border-slate-600"/>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-xs font-medium block mb-1 text-slate-500">Font</label>
                                            <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} className="w-full p-2 border rounded-md text-sm dark:bg-slate-700 dark:border-slate-600"><option value="sans-serif">Sans-Serif</option><option value="serif">Serif</option><option value="monospace">Monospace</option></select>
                                        </div>
                                        {labelType === 'barcode' && (
                                        <div>
                                            <label className="text-xs font-medium block mb-1 text-slate-500">Barkod Tipi</label>
                                            <select value={barcodeFormat} onChange={(e) => setBarcodeFormat(e.target.value)} className="w-full p-2 border rounded-md text-sm dark:bg-slate-700 dark:border-slate-600"><option value="CODE128">Barkod (128)</option><option value="QR">QR Kod</option></select>
                                        </div>
                                        )}
                                    </div>
                                    
                                    {/* YENİ BARKOD YÜKSEKLİĞİ AYARI (Sadece EAN13 ise) */}
                                    {labelType === 'barcode' && barcodeFormat === 'CODE128' && (
                                        <div>
                                            <label className="text-xs font-medium block mb-1 text-slate-500">Barkod Yüksekliği</label>
                                            <div className="flex items-center gap-2">
                                                <input 
                                                    type="range" 
                                                    min="10" 
                                                    max="100" 
                                                    value={barcodeHeight} 
                                                    onChange={(e) => setBarcodeHeight(Number(e.target.value))} 
                                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                                                />
                                                <span className="text-xs w-8 text-right">{barcodeHeight}</span>
                                            </div>
                                        </div>
                                    )}

                                    {labelType === 'barcode' && (
                                    <label className="flex items-center space-x-2 text-sm cursor-pointer p-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded">
                                        <input type="checkbox" checked={isFirstLineBold} onChange={e => setIsFirstLineBold(e.target.checked)} className="rounded text-blue-600"/>
                                        <span>İlk satırı kalın yap (Başlık/Yer No)</span>
                                    </label>
                                    )}
                                    {labelType === 'spine' && (
                                        <div className="space-y-2">
                                            <label className="flex items-center space-x-2 text-sm cursor-pointer p-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded">
                                                <input type="checkbox" checked={spineMainTextBold} onChange={e => setSpineMainTextBold(e.target.checked)} className="rounded text-blue-600"/>
                                                <span>Metni Kalın Yap (Bold)</span>
                                            </label>
                                            
                                            <div className="p-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded">
                                                <label className="text-xs font-medium block mb-1 text-slate-500">Yazı Dikey Konum (mm)</label>
                                                <div className="flex items-center gap-2">
                                                    <input 
                                                        type="range" 
                                                        min="-10" 
                                                        max="10" 
                                                        step="0.5"
                                                        value={spineTextVerticalShift} 
                                                        onChange={(e) => setSpineTextVerticalShift(Number(e.target.value))} 
                                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                                                    />
                                                    <span className="text-xs w-8 text-right">{spineTextVerticalShift}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {labelType === 'barcode' && (
                            <div>
                                <h4 className="font-semibold text-sm mb-3">Logo Ayarları</h4>
                                <div className="p-3 border rounded-lg dark:border-slate-600">
                                    <div className="flex items-center space-x-2 text-sm mb-3">
                                        <input type="checkbox" id="ministryLogoCheck" checked={useMinistryLogo} onChange={handleMinistryLogoToggle} className="rounded text-blue-600"/>
                                        <label htmlFor="ministryLogoCheck" className="cursor-pointer select-none">Varsayılan Logo</label>
                                    </div>
                                    <div className="space-y-3">
                                        {!useMinistryLogo && (
                                            <div>
                                                <label className="text-xs font-medium block mb-1 text-slate-500">Özel Logo Yükle</label>
                                                <input type="file" accept="image/*" onChange={handleLogoChange} className="text-xs w-full file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"/>
                                            </div>
                                        )}
                                        <div>
                                            <label className="text-xs font-medium block mb-1 text-slate-500">Logo Yüksekliği (mm)</label>
                                            <input type="number" value={logoSize} onChange={(e) => setLogoSize(Number(e.target.value))} className="w-full p-2 border rounded-md text-sm dark:bg-slate-700 dark:border-slate-600"/>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            )}
                            
                            {labelType === 'spine' && (
                                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-100 dark:border-yellow-800">
                                    <h4 className="font-semibold text-sm mb-3 text-yellow-800 dark:text-yellow-300">Sırt Etiketi Ayarları</h4>
                                    <div className="space-y-3">
                                        
                                        <div className="space-y-2 pt-1">
                                            <h5 className="text-xs font-bold text-yellow-700 dark:text-yellow-400 uppercase">Barkod Numarası</h5>
                                            <label className="flex items-center space-x-2 text-sm cursor-pointer">
                                                <input type="checkbox" checked={showSpineBarcode} onChange={e => setShowSpineBarcode(e.target.checked)} className="rounded text-blue-600"/>
                                                <span>Numarayı Göster</span>
                                            </label>
                                        
                                            {showSpineBarcode && (
                                                <>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div>
                                                            <label className="text-xs font-medium block mb-1 text-slate-500">Konum</label>
                                                            <select value={spineBarcodePosition} onChange={e => setSpineBarcodePosition(e.target.value)} className="w-full p-1.5 border rounded text-sm dark:bg-slate-700 dark:border-slate-600">
                                                                <option value="top">Üstte</option>
                                                                <option value="bottom">Altta</option>
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="text-xs font-medium block mb-1 text-slate-500">Boyut (pt)</label>
                                                            <input type="number" value={spineBarcodeFontSize} onChange={e => setSpineBarcodeFontSize(Number(e.target.value))} className="w-full p-1.5 border rounded text-sm dark:bg-slate-700 dark:border-slate-600"/>
                                                        </div>
                                                    </div>
                                                    <label className="flex items-center space-x-2 text-sm cursor-pointer mt-1">
                                                        <input type="checkbox" checked={spineBarcodeBold} onChange={e => setSpineBarcodeBold(e.target.checked)} className="rounded text-blue-600"/>
                                                        <span>Barkod Numarası Kalın</span>
                                                    </label>
                                                    <p className="text-[10px] text-slate-500 mt-2">Otomatik: İlk 4 hane atlanır, kalan kısımdaki baştaki sıfırlar silinir.</p>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="bg-slate-100 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col">
                        <h4 className="font-semibold text-sm mb-4 text-center text-slate-500 uppercase tracking-wider">Canlı Önizleme</h4>
                        <div className="flex-grow flex items-center justify-center overflow-hidden py-8 bg-slate-200 dark:bg-slate-800 rounded-lg inner-shadow">
                            <div style={{ transform: 'scale(1.5)', transformOrigin: 'center' }}>
                                <div className="bg-white shadow-lg transition-all duration-300" style={{ width: `${settings.labelWidth}mm`, height: `${settings.labelHeight}mm` }}>
                                    {renderSingleLabel({
                                        barcode: '111000000072', // Örnek barkod güncellendi
                                        title: 'Örnek Kitap Adı',
                                        author: 'Yazar Adı',
                                        itemcallnumber: '398.27 GRİ 2005',
                                        location: 'Genel Koleksiyon'
                                    }, 'preview')}
                                </div>
                            </div>
                        </div>
                        <p className="text-xs text-center mt-4 text-slate-400">Gerçek baskıda kenar çizgileri kesikli olacaktır.</p>
                    </div>
                </div>
                
                <div className="grid md:grid-cols-2 gap-8 mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
                    <div>
                        <h4 className="font-semibold text-sm mb-3">Kağıt Düzeni</h4>
                        <select value={selectedTemplateKey} onChange={(e) => loadTemplate(e.target.value)} className="w-full p-2.5 border rounded-md text-sm mb-4 bg-white dark:bg-slate-700 dark:border-slate-600 shadow-sm">
                            <option value="system4">Barkod: A4 - 4 Sütunlu (46x22mm)</option>
                            <option value="system3">Barkod: A4 - 3 Sütunlu (69x25mm)</option>
                            <option value="spine_system">Sırt Etiketi: Sistem (52x30mm)</option>
                            <option value="spine_sample">Sırt Etiketi: Örnek (30x50mm)</option>
                            <option value="custom">Özel Ayarlar...</option>
                            {Object.keys(customTemplates).length > 0 && <option value="load_custom" disabled>--- Kayıtlı Şablonlar ---</option>}
                            {Object.keys(customTemplates).map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                        
                        {selectedTemplateKey === 'custom' && (
                            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm bg-slate-50 dark:bg-slate-700/30 p-3 rounded border dark:border-slate-600">
                                {Object.keys(settings).filter(k => k !== 'name' && k !== 'unit').map(key => (
                                    <label key={key} className="flex flex-col">
                                        <span className="text-xs text-slate-500 mb-1">{settingLabels[key] || key} (mm)</span>
                                        <input type="number" value={settings[key]} onChange={e=>handleSettingChange(key, e.target.value)} className="p-1.5 border rounded dark:bg-slate-700 dark:border-slate-600 text-sm"/>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                     <div>
                        <h4 className="font-semibold text-sm mb-3">Şablon Yönetimi</h4>
                         <div className="flex items-center gap-2 mb-4">
                            <input type="text" placeholder="Şablon adı (Örn: Brother 62mm)" value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)} className="flex-grow p-2.5 border rounded-md text-sm dark:bg-slate-700 dark:border-slate-600" />
                            <button onClick={handleSaveTemplate} className="px-4 py-2.5 border rounded-md text-sm bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200 transition-colors font-medium">Kaydet</button>
                        </div>
                        
                        <div className="bg-slate-50 dark:bg-slate-700/30 rounded-lg border dark:border-slate-600 p-3 max-h-40 overflow-y-auto">
                            <h5 className="text-xs font-bold text-slate-400 uppercase mb-2">Kayıtlı Şablonlar</h5>
                            {Object.keys(customTemplates).length > 0 ? (
                                <div className="space-y-1">
                                    {Object.keys(customTemplates).map(name => (
                                        <div key={name} className="flex justify-between items-center text-sm p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700"><span>{name}</span><div><button onClick={() => {setSelectedTemplateKey(name); setSettings(customTemplates[name])}} className="text-xs mr-2 text-blue-600 dark:text-blue-400">Yükle</button><button onClick={() => handleDeleteTemplate(name)} className="text-xs text-red-600 dark:text-red-400">Sil</button></div></div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-slate-500 italic text-center py-2">Henüz kaydedilmiş özel şablon yok.</p>
                            )}
                        </div>
                    </div>
                </div>
             </div>

            <div className="w-full flex flex-col gap-6">
                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm no-print">
                     <div className="mb-4"><label className="text-sm font-medium block mb-1">PDF Dosya Adı</label><input type="text" value={pdfFileName} onChange={(e) => setPdfFileName(e.target.value)} className="w-full p-2 border rounded-md text-sm dark:bg-slate-700 dark:border-slate-600" placeholder="etiketler"/></div>
                    <div className="grid grid-cols-2 gap-4">
                        <button onClick={handlePrintAsPdf} className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 shadow disabled:opacity-50" disabled={labelsToPrint.length === 0}>PDF Olarak İndir</button>
                        <button onClick={() => setSelectedBarcodes(new Set())} className="w-full bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 shadow disabled:opacity-50" disabled={selectedBarcodes.size === 0}>Tüm Seçimleri Temizle</button>
                    </div>
                </div>
                
                <main className="w-full flex justify-center items-start">
                  <div id="print-area" className="bg-white shadow-lg overflow-hidden" style={{ width: `${settings.pageWidth}${settings.unit}`, height: `${settings.pageHeight}${settings.unit}`, boxSizing: 'border-box' }}>
                    <div className="grid p-0 m-0" style={{ width: '100%', height: '100%', paddingTop: `${settings.marginTop}${settings.unit}`, paddingLeft: `${settings.marginLeft}${settings.unit}`, gridTemplateColumns: `repeat(${settings.numCols}, ${settings.labelWidth}${settings.unit})`, gridTemplateRows: `repeat(${settings.numRows}, ${settings.labelHeight}${settings.unit})`, columnGap: `${settings.colGap}${settings.unit}`, rowGap: `${settings.rowGap}${settings.unit}` }}>
                      {renderLabels()}
                    </div>
                  </div>
                </main>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;