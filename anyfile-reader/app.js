// AnyReader — Main Application Logic

// Initialize PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ==========================================================================
   0. SHARED HELPERS (escaping / sanitizing / persisted settings)
   ========================================================================== */

// Supported formats + selectable themes, declared once instead of magic strings.
const SUPPORTED_EXTENSIONS = ['epub', 'pdf', 'mobi', 'txt', 'md'];
const THEMES = ['oreilly', 'light', 'sepia', 'dark', 'black'];
const SETTINGS_KEY = 'anyreader_settings';

// Escape text for safe interpolation into HTML (covers element text AND attribute values).
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Escape a string for safe use inside a RegExp (prevents query-driven regex breakage/injection).
function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Sanitize untrusted rich HTML (MOBI bodies are HTML internally). Prefers DOMPurify;
// falls back to full escaping so a missing CDN can never leave a raw-HTML sink.
function sanitizeHtml(html) {
    if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) {
        return DOMPurify.sanitize(html, {
            FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus']
        });
    }
    return escapeHtml(html);
}

/* ==========================================================================
   1. DATABASE MANAGER (IndexedDB Wrapper)
   ========================================================================== */
const DB_NAME = "AnyReaderDB";
const DB_VERSION = 1;

class DbManager {
    static _dbPromise = null;

    static init() {
        // Memoize a single connection; reused by every operation for the page lifetime.
        if (DbManager._dbPromise) return DbManager._dbPromise;

        DbManager._dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => { DbManager._dbPromise = null; reject(request.error); };

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains("books")) {
                    db.createObjectStore("books", { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains("progress")) {
                    db.createObjectStore("progress", { keyPath: "bookId" });
                }
                if (!db.objectStoreNames.contains("notes")) {
                    db.createObjectStore("notes", { keyPath: "id", autoIncrement: true });
                }
            };

            request.onsuccess = () => {
                const db = request.result;
                // Close + drop the cached handle if another tab bumps the version,
                // so a future DB_VERSION upgrade is never blocked.
                db.onversionchange = () => { db.close(); DbManager._dbPromise = null; };
                resolve(db);
            };
        });

        return DbManager._dbPromise;
    }
    
    static saveBook(book) {
        return DbManager.init().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction("books", "readwrite");
                const store = tx.objectStore("books");
                const request = store.put(book);
                request.onsuccess = () => resolve(book.id);
                request.onerror = () => reject(request.error);
            });
        });
    }
    
    static getBooks() {
        return DbManager.init().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction("books", "readonly");
                const store = tx.objectStore("books");
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        });
    }
    
    static getBook(id) {
        return DbManager.init().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction("books", "readonly");
                const store = tx.objectStore("books");
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        });
    }
    
    static deleteBook(id) {
        return DbManager.init().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction(["books", "progress", "notes"], "readwrite");
                tx.objectStore("books").delete(id);
                tx.objectStore("progress").delete(id);
                
                // Delete notes
                const notesStore = tx.objectStore("notes");
                const request = notesStore.openCursor();
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        if (cursor.value.bookId === id) {
                            cursor.delete();
                        }
                        cursor.continue();
                    }
                };
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        });
    }
    
    static saveProgress(progress) {
        return DbManager.init().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction("progress", "readwrite");
                const store = tx.objectStore("progress");
                const request = store.put(progress);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        });
    }
    
    static getProgress(bookId) {
        return DbManager.init().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction("progress", "readonly");
                const store = tx.objectStore("progress");
                const request = store.get(bookId);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        });
    }

    static getAllProgress() {
        return DbManager.init().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction("progress", "readonly");
                const store = tx.objectStore("progress");
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        });
    }
    
    static saveNote(note) {
        return DbManager.init().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction("notes", "readwrite");
                const store = tx.objectStore("notes");
                const request = store.put(note);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        });
    }
    
    static getNotes(bookId) {
        return DbManager.init().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction("notes", "readonly");
                const store = tx.objectStore("notes");
                const notes = [];
                const request = store.openCursor();
                request.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        if (cursor.value.bookId === bookId) {
                            notes.push(cursor.value);
                        }
                        cursor.continue();
                    } else {
                        resolve(notes);
                    }
                };
                request.onerror = () => reject(request.error);
            });
        });
    }
    
    static deleteNote(id) {
        return DbManager.init().then(db => {
            return new Promise((resolve, reject) => {
                const tx = db.transaction("notes", "readwrite");
                const store = tx.objectStore("notes");
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        });
    }
}


/* ==========================================================================
   2. MOBI & KINDLE FILE BINARY PARSER
   ========================================================================== */
class MobiParser {
    static parse(arrayBuffer, fileName) {
        try {
            const view = new DataView(arrayBuffer);
            const decoder = new TextDecoder('utf-8');
            
            // Read Title from first 32 bytes of PDB header
            let pdbTitle = "";
            for (let i = 0; i < 32; i++) {
                let charCode = view.getUint8(i);
                if (charCode === 0) break;
                pdbTitle += String.fromCharCode(charCode);
            }
            
            const numRecords = view.getUint16(76);
            
            // Extract record offsets
            const records = [];
            for (let i = 0; i < numRecords; i++) {
                const offset = view.getUint32(78 + i * 8);
                const nextOffset = (i < numRecords - 1) ? view.getUint32(78 + (i + 1) * 8) : arrayBuffer.byteLength;
                records.push({ offset, length: nextOffset - offset });
            }
            
            if (numRecords === 0) {
                throw new Error("No database records found in Kindle file.");
            }
            
            // Record 0 contains the MOBI headers
            const rec0 = records[0];
            const rec0Data = new Uint8Array(arrayBuffer, rec0.offset, rec0.length);
            
            const compression = view.getUint16(rec0.offset);
            const textLength = view.getUint32(rec0.offset + 4);
            const recordCount = view.getUint16(rec0.offset + 8);
            const encryption = view.getUint16(rec0.offset + 12);
            
            // Read MOBI identifier at offset 16 (length 4)
            let identifier = "";
            for (let i = 0; i < 4; i++) {
                identifier += String.fromCharCode(view.getUint8(rec0.offset + 16 + i));
            }
            
            if (identifier !== "MOBI") {
                throw new Error("Invalid Kindle format (Missing MOBI signature).");
            }
            
            if (encryption !== 0) {
                throw new Error("This Kindle file is encrypted with DRM and cannot be parsed.");
            }
            
            // Read full title if present inside MOBI header details
            let fullTitle = "";
            try {
                const titleOffset = view.getUint32(rec0.offset + 84);
                const titleLength = view.getUint32(rec0.offset + 88);
                if (titleOffset && titleLength && (titleOffset + titleLength < rec0.length)) {
                    const titleBytes = rec0Data.subarray(titleOffset, titleOffset + titleLength);
                    fullTitle = decoder.decode(titleBytes);
                }
            } catch (e) {
                console.warn("Failed reading MOBI title from header", e);
            }
            
            if (!fullTitle) fullTitle = pdbTitle || fileName.replace(/\.[^/.]+$/, "");
            
            // Determine encoding (1252: CP1252/WinLatin, 65001: UTF-8)
            const encodingType = view.getUint32(rec0.offset + 28);
            const textDecoderEncoding = (encodingType === 65001) ? 'utf-8' : 'windows-1252';
            const contentDecoder = new TextDecoder(textDecoderEncoding);
            
            // Decompress book body records (records 1 to recordCount)
            let bookText = "";
            for (let i = 1; i <= recordCount && i < numRecords; i++) {
                const record = records[i];
                const recData = new Uint8Array(arrayBuffer, record.offset, record.length);
                
                let decompressed;
                if (compression === 1) {
                    decompressed = recData; // no compression
                } else if (compression === 2) {
                    decompressed = MobiParser.decompressPalmDoc(recData); // PalmDoc LZ77
                } else {
                    throw new Error("Unrecognized Kindle compression algorithm (HUFF/CDIC).");
                }
                
                bookText += contentDecoder.decode(decompressed);
            }
            
            // Return parsed metadata and content
            return {
                title: fullTitle,
                author: "Kindle Author",
                content: bookText,
                format: "mobi"
            };
        } catch (e) {
            throw new Error("Kindle Parsing Error: " + e.message);
        }
    }
    
    // PalmDoc LZ77 decompression helper
    static decompressPalmDoc(data) {
        let out = [];
        let i = 0;
        while (i < data.length) {
            let c = data[i++];
            if (c === 0) {
                out.push(0);
            } else if (c >= 1 && c <= 8) {
                for (let j = 0; j < c && i < data.length; j++) {
                    out.push(data[i++]);
                }
            } else if (c >= 9 && c <= 0x7f) {
                out.push(c);
            } else if (c >= 0x80 && c <= 0xbf) {
                if (i >= data.length) break;
                let next = data[i++];
                let sequence = (c << 8) | next;
                let distance = (sequence >> 3) & 0x07ff;
                let length = (next & 7) + 3;
                let start = out.length - distance;
                for (let j = 0; j < length; j++) {
                    if (start + j >= 0 && start + j < out.length) {
                        out.push(out[start + j]);
                    } else {
                        out.push(32); // Space fallback
                    }
                }
            } else if (c >= 0xc0) {
                out.push(32); // Space
                out.push(c ^ 0x80);
            }
        }
        return new Uint8Array(out);
    }
}


/* ==========================================================================
   3. TEXT/MARKDOWN PARSER
   ========================================================================== */
class TxtParser {
    static parse(rawText, fileName) {
        const title = fileName.replace(/\.[^/.]+$/, "");
        
        // Escape HTML tags to prevent broken markdown injections
        const escaped = rawText
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
            
        const lines = escaped.split(/\r?\n/);
        let htmlContent = "";
        let inList = false;
        let inCodeBlock = false;
        
        // Helper to parse inline markdown elements (bold, italic, inline code)
        function parseInline(text) {
            return text
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                .replace(/__([^_]+)__/g, '<strong>$1</strong>')
                .replace(/\*([^*]+)\*/g, '<em>$1</em>')
                .replace(/_([^_]+)_/g, '<em>$1</em>');
        }
        
        for (let line of lines) {
            const trimmed = line.trim();
            
            if (trimmed === "") {
                if (inList) {
                    htmlContent += "</ul>\n";
                    inList = false;
                }
                continue;
            }
            
            // Code Blocks (```)
            if (trimmed.startsWith("```")) {
                if (inCodeBlock) {
                    htmlContent += "</code></pre>\n";
                    inCodeBlock = false;
                } else {
                    htmlContent += "<pre><code>";
                    inCodeBlock = true;
                }
                continue;
            }
            
            if (inCodeBlock) {
                htmlContent += line + "\n";
                continue;
            }
            
            // Title headers
            if (trimmed.startsWith("### ")) {
                if (inList) { htmlContent += "</ul>\n"; inList = false; }
                htmlContent += `<h3>${parseInline(trimmed.slice(4))}</h3>\n`;
            } else if (trimmed.startsWith("## ")) {
                if (inList) { htmlContent += "</ul>\n"; inList = false; }
                htmlContent += `<h2>${parseInline(trimmed.slice(3))}</h2>\n`;
            } else if (trimmed.startsWith("# ")) {
                if (inList) { htmlContent += "</ul>\n"; inList = false; }
                htmlContent += `<h1>${parseInline(trimmed.slice(2))}</h1>\n`;
            }
            // Bullet Lists
            else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                if (!inList) {
                    htmlContent += "<ul>\n";
                    inList = true;
                }
                htmlContent += `<li>${parseInline(trimmed.slice(2))}</li>\n`;
            }
            // Normal Paragraphs
            else {
                if (inList) { htmlContent += "</ul>\n"; inList = false; }
                htmlContent += `<p>${parseInline(trimmed)}</p>\n`;
            }
        }
        
        if (inList) htmlContent += "</ul>\n";
        if (inCodeBlock) htmlContent += "</code></pre>\n";
        
        return {
            title: title,
            author: "Local Text Document",
            content: htmlContent,
            format: "txt"
        };
    }
}


/* ==========================================================================
   4. PROCEDURAL COVER GENERATOR
   ========================================================================== */
function generateProceduralCover(title, author, format) {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 450;
    const ctx = canvas.getContext('2d');
    
    // Create title hash for unique but persistent colors
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
        hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    
    // Draw background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 450);
    grad.addColorStop(0, `hsl(${hue}, 35%, 18%)`);
    grad.addColorStop(1, `hsl(${(hue + 45) % 360}, 40%, 10%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 300, 450);
    
    // Add canvas texture noise
    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    for (let i = 0; i < 3000; i++) {
        const x = Math.random() * 300;
        const y = Math.random() * 450;
        ctx.fillRect(x, y, 1.2, 1.2);
    }
    
    // O'Reilly classic double border frame
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 2;
    ctx.strokeRect(15, 15, 270, 420);
    ctx.strokeRect(20, 20, 260, 410);
    
    // Format badge
    ctx.fillStyle = format === "pdf" ? "#b91c1c" : 
                    format === "epub" ? "#5b21b6" : 
                    format === "mobi" ? "#c2410c" : "#047857";
    ctx.fillRect(30, 35, 45, 18);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 9px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(format.toUpperCase(), 52.5, 44);
    
    // Title
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.font = "italic bold 22px 'Playfair Display', Georgia, serif";
    
    // Word wrapping
    const words = title.split(' ');
    let line = '';
    let y = 110;
    const maxWidth = 240;
    const lineHeight = 28;
    
    for (let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        let metrics = ctx.measureText(testLine);
        let testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
            ctx.fillText(line, 30, y);
            line = words[n] + ' ';
            y += lineHeight;
        } else {
            line = testLine;
        }
        if (y > 270) break;
    }
    ctx.fillText(line, 30, y);
    
    // Divider
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, y + 40);
    ctx.lineTo(270, y + 40);
    ctx.stroke();
    
    // Author
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.font = "500 13px 'Inter', sans-serif";
    ctx.fillText(author || "Local Reader Document", 30, y + 65);
    
    // Bottom brand
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    ctx.font = "600 9px 'Inter', sans-serif";
    ctx.fillText("ANYREADER PUBLISHING", 30, 415);
    
    return canvas.toDataURL();
}


/* ==========================================================================
   5. READER & RENDERING CORE
   ========================================================================== */
class EBookReader {
    constructor() {
        this.currentBook = null;
        this.epubBook = null;
        this.epubRendition = null;
        this.pdfDoc = null;
        this.pdfNumPages = 0;
        this.pdfCurrentPage = 1;
        this.pdfScale = 1.3;
        this.pdfObserver = null;
        this.activeTheme = 'black';

        // Reader Configuration States
        this.fontSize = 100; // in percent
        this.lineHeight = 1.6;
        this.margin = 'medium'; // narrow, medium, wide
        this.splitView = false;

        // Restore persisted reader settings (theme/font/size/spacing/margin).
        this.loadSettings();

        // Timer analytics
        this.readSeconds = 0;
        this.timerInterval = null;

        // Speech Synthesis (Text to Speech)
        this.speechUtterance = null;
        this.isSpeaking = false;

        this.initElements();
        this.applySettingsToControls();
        this.bindEvents();
        this.setupThemes();
        this.initAnalytics();
        this.loadShelf();
        this.preloadDefaultBook();
        this.initLanding();
    }

    async preloadDefaultBook() {
        const defaultBookId = "rachel-khong-stories";
        const existing = await DbManager.getBook(defaultBookId);
        if (existing) return;
        
        try {
            console.log("Preloading default EPUB book: Rachel Khong - Stories...");
            const response = await fetch('./My_Dear_You__Stories_-_Rachel_Khong.epub');
            if (!response.ok) {
                console.warn("Default EPUB book not found at path './My_Dear_You__Stories_-_Rachel_Khong.epub'.");
                return;
            }
            
            const arrayBuffer = await response.arrayBuffer();
            
            // Render ePub package metadata
            const tempBook = ePub(arrayBuffer);
            await tempBook.opened;
            const meta = tempBook.package.metadata;
            
            const bookData = {
                id: defaultBookId,
                title: meta.title || "My Dear You: Stories",
                author: meta.creator || "Rachel Khong",
                content: arrayBuffer,
                format: "epub",
                added: Date.now()
            };
            
            // Generate procedural cover
            bookData.cover = generateProceduralCover(bookData.title, bookData.author, "epub");
            
            // Save to DB
            await DbManager.saveBook(bookData);
            console.log("Default EPUB book loaded successfully.");
            this.loadShelf();
        } catch (e) {
            console.error("Failed to load default EPUB book", e);
        }
    }

    loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
            if (THEMES.includes(saved.theme)) this.activeTheme = saved.theme;
            if (typeof saved.fontSize === "number") this.fontSize = saved.fontSize;
            if (typeof saved.lineHeight === "number") this.lineHeight = saved.lineHeight;
            if (['narrow', 'medium', 'wide'].includes(saved.margin)) this.margin = saved.margin;
            this._savedFontFamily = saved.fontFamily || null;
            if (typeof saved.splitView === "boolean") {
                this.splitView = saved.splitView;
            } else {
                this.splitView = window.innerWidth >= 768;
            }
        } catch (e) {
            console.warn("Could not parse saved settings", e);
            this.splitView = window.innerWidth >= 768;
        }
    }

    saveSettings() {
        const settings = {
            theme: this.activeTheme,
            fontSize: this.fontSize,
            lineHeight: this.lineHeight,
            margin: this.margin,
            fontFamily: document.getElementById("font-family-select")?.value,
            splitView: this.splitView
        };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    // Reflect restored settings into the style-panel controls on startup.
    applySettingsToControls() {
        document.getElementById("font-size-val").innerText = `${this.fontSize}%`;
        document.getElementById("line-height-val").innerText = this.lineHeight;
        if (this._savedFontFamily) {
            const sel = document.getElementById("font-family-select");
            if (sel) {
                const cleanFont = this._savedFontFamily.split(',')[0].replace(/['"]/g, '').trim();
                const hasOption = Array.from(sel.options).some(opt => opt.value === cleanFont);
                if (hasOption) {
                    sel.value = cleanFont;
                } else {
                    // Try to match key options directly or default
                    sel.value = cleanFont || "Georgia";
                }
            }
        }
        document.querySelectorAll(".margin-btn").forEach(b =>
            b.classList.toggle("active", b.dataset.margin === this.margin));
    }
    
    initElements() {
        // Views
        this.dashboardView = document.getElementById("dashboard-view");
        this.readerView = document.getElementById("reader-view");
        
        // Shelf
        this.shelfGrid = document.getElementById("book-shelf-grid");
        this.emptyState = document.getElementById("empty-state");
        this.fileInput = document.getElementById("file-input");
        this.dropzone = document.getElementById("dropzone");
        this.uploadTrigger = document.getElementById("upload-trigger-btn");
        this.loadSampleBtn = document.getElementById("load-sample-btn");
        
        // Reader Header Controls
        this.closeReaderBtn = document.getElementById("close-reader-btn");
        this.readerBookTitle = document.getElementById("reader-book-title");
        this.readerBookAuthor = document.getElementById("reader-book-author");
        this.readingProgressText = document.getElementById("reading-progress-text");
        
        // Toolbar options
        this.sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
        this.splitViewBtn = document.getElementById("split-view-btn");
        this.stylePanelBtn = document.getElementById("style-panel-btn");
        this.ttsBtn = document.getElementById("tts-btn");
        this.bookmarkToggleBtn = document.getElementById("bookmark-toggle-btn");
        this.fullscreenBtn = document.getElementById("fullscreen-btn");
        
        // Pages turning
        this.prevPageBtn = document.getElementById("prev-page-btn");
        this.nextPageBtn = document.getElementById("next-page-btn");
        
        // View containers
        this.viewerContainer = document.getElementById("viewer-container");
        this.epubViewer = document.getElementById("epub-viewer");
        this.pdfViewer = document.getElementById("pdf-viewer");
        this.customViewer = document.getElementById("custom-viewer");
        this.customContent = document.getElementById("custom-content");
        
        // Sidebar & Popovers
        this.sidebar = document.getElementById("reader-sidebar");
        this.stylePanel = document.getElementById("style-panel");
        this.closeStylePanel = document.getElementById("close-style-panel");
        
        // Annotation Modals & Tooltips
        this.selectionTooltip = document.getElementById("selection-tooltip");
        this.noteModal = document.getElementById("note-modal");
        this.closeNoteModalBtn = document.getElementById("close-note-modal-btn");
        this.saveNoteBtn = document.getElementById("save-note-btn");
        this.noteTextarea = document.getElementById("note-textarea");
        this.noteQuote = document.getElementById("note-quote");
        
        this.selectedText = "";
        this.selectedRange = null;
        this.selectedEpubCfi = null;
        
        // Toast
        this.toast = document.getElementById("reader-toast");
    }
    
    bindEvents() {
        // File Upload Drag & Drop
        this.uploadTrigger.addEventListener("click", () => this.fileInput.click());
        this.fileInput.addEventListener("change", (e) => this.handleFiles(e.target.files));
        
        this.dropzone.addEventListener("dragover", (e) => {
            e.preventDefault();
            this.dropzone.classList.add("dragover");
        });
        
        this.dropzone.addEventListener("dragleave", () => {
            this.dropzone.classList.remove("dragover");
        });
        
        this.dropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            this.dropzone.classList.remove("dragover");
            if (e.dataTransfer.files.length > 0) {
                this.handleFiles(e.dataTransfer.files);
            }
        });
        
        this.loadSampleBtn.addEventListener("click", () => this.loadSampleBook());
        
        // Global Theme Toggle
        document.getElementById("theme-toggle-btn").addEventListener("click", () => {
            const nextIndex = (THEMES.indexOf(this.activeTheme) + 1) % THEMES.length;
            this.setTheme(THEMES[nextIndex]);
        });
        
        // Reader Exit
        this.closeReaderBtn.addEventListener("click", () => this.exitReader());
        
        // Reader Toolbar
        this.sidebarToggleBtn.addEventListener("click", () => {
            this.sidebar.classList.toggle("open");
            this.sidebarToggleBtn.classList.toggle("active", this.sidebar.classList.contains("open"));
            if (this.epubRendition) {
                setTimeout(() => {
                    if (this.epubRendition && this.epubRendition.manager) {
                        this.epubRendition.resize();
                    }
                }, 300);
            }
        });
        
        this.splitViewBtn.addEventListener("click", () => this.toggleSplitView());
        this.stylePanelBtn.addEventListener("click", () => this.toggleStylePanel(true));
        this.closeStylePanel.addEventListener("click", () => this.toggleStylePanel(false));
        this.ttsBtn.addEventListener("click", () => this.toggleTTS());
        this.bookmarkToggleBtn.addEventListener("click", () => this.toggleBookmark());
        this.fullscreenBtn.addEventListener("click", () => this.toggleFullscreen());
        
        // Page navigation controls
        this.prevPageBtn.addEventListener("click", () => this.prevPage());
        this.nextPageBtn.addEventListener("click", () => this.nextPage());
        
        // Sidebar tabs toggling
        const tabs = this.sidebar.querySelectorAll(".sidebar-tab");
        tabs.forEach(tab => {
            tab.addEventListener("click", () => {
                tabs.forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                
                const targetPanelId = "panel-" + tab.dataset.tab;
                const panels = this.sidebar.querySelectorAll(".sidebar-panel");
                panels.forEach(p => p.classList.remove("active"));
                document.getElementById(targetPanelId).classList.add("active");
            });
        });
        
        // Text selection events for Highlights (standard selection)
        document.addEventListener("mouseup", (e) => this.handleTextSelection(e));
        // Keyboard selection (Shift+Arrows / Home / End) also surfaces the tooltip.
        document.addEventListener("keyup", (e) => {
            if (e.shiftKey || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                this.handleTextSelection(e);
            }
        });

        // Tooltip action buttons. mousedown preserves the selection for mouse users;
        // a keydown handler adds Enter/Space activation for keyboard users.
        const activateHighlight = (color) => this.addHighlight(color);
        this.selectionTooltip.querySelectorAll(".hl-dot").forEach(dot => {
            dot.addEventListener("mousedown", (e) => {
                e.preventDefault(); // Prevent clearing selection
                activateHighlight(dot.dataset.color);
            });
            dot.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activateHighlight(dot.dataset.color);
                }
            });
        });

        const noteBtn = document.getElementById("tooltip-note-btn");
        const openNote = (e) => { e.preventDefault(); this.openNoteModal(); };
        noteBtn.addEventListener("mousedown", openNote);
        noteBtn.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") openNote(e);
        });

        const copyBtn = document.getElementById("tooltip-copy-btn");
        const doCopy = (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(this.selectedText);
            this.showToast("Text Copied!");
            this.clearSelection();
        };
        copyBtn.addEventListener("mousedown", doCopy);
        copyBtn.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") doCopy(e);
        });
        
        this.closeNoteModalBtn.addEventListener("click", () => {
            this.noteModal.classList.remove("active");
            this.clearSelection();
            this._restoreFocus();
        });
        
        this.saveNoteBtn.addEventListener("click", () => this.saveNote());
        
        // Style controls listeners
        document.querySelectorAll(".theme-opt").forEach(opt => {
            opt.addEventListener("click", () => {
                document.querySelectorAll(".theme-opt").forEach(o => o.classList.remove("active"));
                opt.classList.add("active");
                this.setTheme(opt.dataset.theme);
            });
        });
        
        document.getElementById("font-family-select").addEventListener("change", (e) => {
            this.setFontFamily(e.target.value);
        });
        
        document.getElementById("font-size-dec").addEventListener("click", () => this.adjustFontSize(-10));
        document.getElementById("font-size-inc").addEventListener("click", () => this.adjustFontSize(10));
        
        document.getElementById("line-height-dec").addEventListener("click", () => this.adjustLineHeight(-0.1));
        document.getElementById("line-height-inc").addEventListener("click", () => this.adjustLineHeight(0.1));
        
        document.querySelectorAll(".margin-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".margin-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                this.setMargin(btn.dataset.margin);
            });
        });
        
        // Keyboard binds
        document.addEventListener("keydown", (e) => {
            if (!this.readerView.classList.contains("active")) return;

            if (e.key === "Escape") {
                // Close the most-blocking overlay first.
                if (this.noteModal.classList.contains("active")) {
                    this.noteModal.classList.remove("active");
                    this.clearSelection();
                    this._restoreFocus();
                } else if (this.selectionTooltip.classList.contains("active")) {
                    this.clearSelection();
                } else {
                    this.toggleStylePanel(false);
                }
                return;
            }

            // Don't hijack arrow keys while typing in an input/textarea/editable field.
            const t = e.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

            if (e.key === "ArrowLeft") this.prevPage();
            if (e.key === "ArrowRight") this.nextPage();
        });
        
        // Search inside book
        document.getElementById("inbook-search-btn").addEventListener("click", () => this.searchInsideBook());
        document.getElementById("inbook-search-input").addEventListener("keypress", (e) => {
            if (e.key === 'Enter') this.searchInsideBook();
        });
        
        // Shelf Filter Buttons
        document.querySelectorAll(".filter-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                this.filterShelf(btn.dataset.filter);
            });
        });
        
        // Dismiss the style popover on any click outside it (and outside its trigger).
        document.addEventListener("click", (e) => {
            if (this.stylePanel.style.display === "flex" &&
                !this.stylePanel.contains(e.target) &&
                !this.stylePanelBtn.contains(e.target)) {
                this.toggleStylePanel(false);
            }
        });

        // Single, debounced scroll listener for reflowable (TXT/MOBI) progress.
        // Bound once for the app lifetime — renderCustomContent no longer adds its own.
        let scrollSaveTimer = null;
        this.viewerContainer.addEventListener("scroll", () => {
            if (!this.currentBook) return;
            if (this.currentBook.format === 'epub' || this.currentBook.format === 'pdf') return;
            const totalHeight = this.viewerContainer.scrollHeight - this.viewerContainer.clientHeight;
            const pct = totalHeight > 0 ? (this.viewerContainer.scrollTop / totalHeight) : 0;
            this.readingProgressText.innerText = `Read: ${Math.round(pct * 100)}%`;
            clearTimeout(scrollSaveTimer);
            scrollSaveTimer = setTimeout(() => this.saveCurrentProgress(), 300);
        });
    }
    
    showToast(msg) {
        this.toast.innerText = msg;
        this.toast.classList.add("active");
        setTimeout(() => this.toast.classList.remove("active"), 2000);
    }

    /* ==========================================================================
       5b. LANDING / OPENING VIEW ("Nocturne Library")
       ========================================================================== */
    initLanding() {
        const landing = document.getElementById("landing-view");
        if (!landing) return;

        this.renderSpineStack();

        const enterBtn = document.getElementById("enter-library-btn");
        const sampleBtn = document.getElementById("landing-sample-btn");
        const brand = document.getElementById("brand-home");
        if (enterBtn) enterBtn.addEventListener("click", () => this.enterLibrary());
        if (sampleBtn) sampleBtn.addEventListener("click", () => this.landingSample());
        if (brand) brand.addEventListener("click", () => this.returnToLanding());

        // Trigger the entrance choreography after first paint.
        requestAnimationFrame(() => requestAnimationFrame(() => landing.classList.add("noc-in")));
    }

    // Generate the leaning, overlapping book-spine stack (stable per load via seeded RNG).
    renderSpineStack() {
        const shelf = document.getElementById("noc-shelf");
        if (!shelf) return;
        shelf.innerHTML = "";

        const titles = [
            "The Quiet Hours", "Marginalia", "On Keeping", "Nightshelf", "A Private Index",
            "Vellum & Ash", "The Long Reading", "Notes Toward Silence", "The Closed Door",
            "Lamplight Studies", "Of Paper, Of Ink", "The Unsent Letters"
        ];
        const leathers = ["#5e2018", "#243426", "#7d5a23", "#3a2236", "#2a2d34", "#1f3a3a"];
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const count = window.innerWidth < 900 ? 5 : 8;

        // mulberry32 — deterministic so the stack is stable across reloads.
        let seed = 0x6d2b79f5;
        const rng = () => {
            seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const pick = (arr) => arr[Math.floor(rng() * arr.length)];

        const usedTitles = new Set();
        for (let i = 0; i < count; i++) {
            const spine = document.createElement("div");
            spine.className = "noc-spine" + (i === count - 1 ? " front" : "");

            const color = leathers[i % leathers.length];
            const h = 250 + Math.floor(rng() * 140);
            const w = 54 + Math.floor(rng() * 14);
            const lean = (i - count / 2) * 3 + (rng() * 2 - 1);
            const left = i * (w * 0.64);

            spine.style.height = `${h}px`;
            spine.style.width = `${w}px`;
            spine.style.left = `${left}px`;
            spine.style.background =
                `linear-gradient(100deg, rgba(0,0,0,0.42), ${color} 42%, ${color} 70%, rgba(0,0,0,0.28))`;
            spine.style.transform = `rotate(${lean.toFixed(2)}deg)`;
            spine.style.setProperty("--lean", `${lean.toFixed(2)}deg`);
            spine.style.zIndex = String(i);
            spine.style.filter = `brightness(${(0.8 + i * 0.03).toFixed(2)})`;
            if (!reduce) {
                spine.style.animation = `noc-spine-settle 0.5s ease-out ${(0.15 + i * 0.08).toFixed(2)}s both`;
            }

            let title = pick(titles);
            let guard = 0;
            while (usedTitles.has(title) && guard++ < 12) title = pick(titles);
            usedTitles.add(title);

            const titleEl = document.createElement("span");
            titleEl.className = "noc-spine-title";
            titleEl.textContent = title;
            spine.appendChild(titleEl);
            shelf.appendChild(spine);
        }
    }

    // Fade the landing away and reveal the dashboard (mirrors exitReader's view swap).
    enterLibrary() {
        const landing = document.getElementById("landing-view");
        if (!landing || !landing.classList.contains("active")) return;
        landing.classList.remove("active");
        document.body.classList.remove("landing-active");
        this.dashboardView.classList.add("active");
        setTimeout(() => { landing.style.display = "none"; }, 360);
    }

    // Bring the opening page back (from the dashboard brand).
    returnToLanding() {
        const landing = document.getElementById("landing-view");
        if (!landing) return;
        this.dashboardView.classList.remove("active");
        landing.style.display = "";
        void landing.offsetWidth; // reflow so the opacity transition replays
        document.body.classList.add("landing-active");
        landing.classList.add("active");
    }

    // Secondary CTA: enter, load the sample, and open it straight away.
    async landingSample() {
        this.enterLibrary();
        await this.loadSampleBook();
        this.openBook("sample-book");
    }

    /* ==========================================================================
       6. FILE PROCESSING
       ========================================================================== */
    handleFiles(fileList) {
        for (let file of fileList) {
            const name = file.name;
            const ext = name.split('.').pop().toLowerCase();

            if (!SUPPORTED_EXTENSIONS.includes(ext)) {
                this.showToast(`Unsupported format: .${ext}`);
                continue;
            }

            const reader = new FileReader();

            reader.onerror = () => this.showToast(`Could not read ${name}`);

            reader.onload = async (e) => {
                const result = e.target.result;
                let parsedBook = null;

                // Parsers like pdf.js transfer (detach) the ArrayBuffer to their
                // worker, which would make it un-storable. Keep a pristine copy for
                // IndexedDB before any parser touches the original.
                const storedContent = (result instanceof ArrayBuffer) ? result.slice(0) : result;

                try {
                    this.showToast(`Loading ${name}...`);

                    if (ext === 'epub') {
                        // Temp load inside memory to extract details
                        const tempBook = ePub(result);
                        await tempBook.opened;
                        const meta = tempBook.package.metadata;
                        parsedBook = {
                            id: `epub-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                            title: meta.title || name.replace(/\.[^/.]+$/, ""),
                            author: meta.creator || "Unknown Author",
                            content: storedContent, // pristine ArrayBuffer copy
                            format: 'epub',
                            added: Date.now()
                        };
                    } else if (ext === 'pdf') {
                        const loadingTask = pdfjsLib.getDocument({ data: result });
                        const pdf = await loadingTask.promise;
                        const meta = await pdf.getMetadata().catch(() => null);
                        const title = (meta && meta.info && meta.info.Title) ? meta.info.Title : name.replace(/\.[^/.]+$/, "");
                        const author = (meta && meta.info && meta.info.Author) ? meta.info.Author : "PDF Document";
                        parsedBook = {
                            id: `pdf-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                            title: title,
                            author: author,
                            content: storedContent, // pristine ArrayBuffer copy
                            format: 'pdf',
                            added: Date.now()
                        };
                    } else if (ext === 'mobi') {
                        const parsed = MobiParser.parse(result, name);
                        parsedBook = {
                            id: `mobi-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                            title: parsed.title,
                            author: parsed.author,
                            content: storedContent, // pristine ArrayBuffer copy of whole mobi
                            format: 'mobi',
                            added: Date.now()
                        };
                    } else if (['txt', 'md'].includes(ext)) {
                        const parsed = TxtParser.parse(result, name);
                        parsedBook = {
                            id: `txt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                            title: parsed.title,
                            author: parsed.author,
                            content: parsed.content, // HTML formatted string
                            format: 'txt',
                            added: Date.now()
                        };
                    }
                    
                    // Normalize metadata at the source so stored values are always plain text.
                    parsedBook.title = String(parsedBook.title || "").slice(0, 300);
                    parsedBook.author = String(parsedBook.author || "").slice(0, 200);

                    // Generate Cover
                    parsedBook.cover = generateProceduralCover(parsedBook.title, parsedBook.author, parsedBook.format);

                    // Save to DB
                    await DbManager.saveBook(parsedBook);
                    this.showToast(`Saved: ${parsedBook.title}`);
                    this.loadShelf();
                } catch (error) {
                    console.error(error);
                    this.showToast(`Failed to open ${name}: ${error.message}`);
                }
            };

            // Assign handlers BEFORE kicking off the read (avoids any onload race).
            if (['txt', 'md'].includes(ext)) {
                reader.readAsText(file);
            } else {
                reader.readAsArrayBuffer(file);
            }
        }
    }
    
    async loadSampleBook() {
        const title = "Welcome to AnyReader! (Tutorial Guide)";
        const author = "AnyReader Publishing Team";
        const content = `
            <h1>Welcome to AnyReader!</h1>
            <p>AnyReader is a state-of-the-art client-side digital library reader built directly in your browser. All of your books, notes, highlights, and layouts are processed and saved locally (offline) using <strong>IndexedDB</strong>, ensuring your data never uploads to any server.</p>
            
            <h2>Key Features</h2>
            <ul>
                <li><strong>Multiple Formats</strong>: Drag and drop PDF, EPUB, DRM-free MOBI, or TXT files.</li>
                <li><strong>O'Reilly Style Typography</strong>: Built with an immersive paper background, beautiful serif structures, and clean coding frames matching O'Reilly standards.</li>
                <li><strong>Flexible layouts</strong>: Toggle split-pane view (double columns) or full-view centered columns.</li>
                <li><strong>Highlights & Notes</strong>: Select text anywhere to create color markers and compile saved notes.</li>
            </ul>

            <h2>O'Reilly Code Block Test</h2>
            <p>For technical and professional manuals, code syntax formatting is extremely critical. Here is a sample code snippet styled with custom font weights:</p>
            <pre><code>// Simple Javascript selection highlight logic
function applyHighlight(range, color) {
    const span = document.createElement("span");
    span.className = \`highlight-node \${color}\`;
    range.surroundContents(span);
    console.log("Applied color highlight!");
}</code></pre>

            <h2>Splitting layout view</h2>
            <p>If you are reading on a desktop or wide monitor, click the book icon on the top right toolbar to toggle the <strong>Split (Two-Column) layout</strong>. Reflowable files (like EPUB or this guide) will format instantly into dual columns mimicking an open book, whereas PDFs can lazy load page canvases side-by-side. Try it out!</p>
            
            <h3>Highlights Checklist</h3>
            <p>Drag your cursor over any sentence in this paragraph. A floaty toolbar will hover above, allowing you to highlight in yellow, green, blue, or pink, add a note, or copy text to the clipboard. Your saved annotations will immediately populate in the sidebar under the highlighter tab!</p>
        `;
        
        const sample = {
            id: "sample-book",
            title: title,
            author: author,
            content: content,
            format: "txt",
            added: Date.now()
        };
        sample.cover = generateProceduralCover(title, author, "txt");
        
        await DbManager.saveBook(sample);
        this.loadShelf();
        this.showToast("Loaded Sample Book!");
    }

    /* ==========================================================================
       7. SHELF LOGIC & RENDER
       ========================================================================= */
    async loadShelf() {
        const books = await DbManager.getBooks();
        this.renderShelf(books);
    }
    
    async filterShelf(format) {
        const books = await DbManager.getBooks();
        if (format === 'all') {
            this.renderShelf(books);
        } else {
            const filtered = books.filter(b => b.format === format);
            this.renderShelf(filtered);
        }
    }
    
    async renderShelf(books) {
        // Fetch progress FIRST, before touching the DOM. Doing the await up front
        // keeps the clear+append below synchronous (atomic) so concurrent
        // renderShelf calls — e.g. two uploads finishing together — can't
        // interleave and double-render the same books.
        const allProgress = await DbManager.getAllProgress();
        const progressMap = new Map(allProgress.map(p => [p.bookId, p]));

        // Clear existing cards
        this.shelfGrid.querySelectorAll(".book-card").forEach(c => c.remove());

        if (books.length === 0) {
            this.emptyState.style.display = "flex";
            document.getElementById("stats-books-count").innerText = "0";
            return;
        }

        this.emptyState.style.display = "none";
        document.getElementById("stats-books-count").innerText = books.length;

        const fragment = document.createDocumentFragment();

        for (let book of books) {
            const progressInfo = progressMap.get(book.id);
            const pct = progressInfo ? Math.round(progressInfo.percentage * 100) : 0;

            const card = document.createElement("div");
            card.className = "book-card";
            card.dataset.id = book.id;

            // Static structure via innerHTML; all untrusted metadata escaped.
            card.innerHTML = `
                <button class="delete-book-btn" title="Delete Book" aria-label="Delete Book">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
                <div class="book-cover-container">
                    <img src="${escapeHtml(book.cover)}" alt="Cover of ${escapeHtml(book.title)}" class="book-cover">
                </div>
                <div class="book-details">
                    <span class="book-card-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</span>
                    <span class="book-card-author">${escapeHtml(book.author)}</span>
                    <div class="book-card-progress">
                        <div class="progress-track">
                            <div class="progress-bar" style="width: ${pct}%"></div>
                        </div>
                        <span class="progress-percent">${pct}%</span>
                    </div>
                </div>
            `;

            card.querySelector(".delete-book-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                this.deleteBook(book.id);
            });
            card.addEventListener("click", () => this.openBook(book.id));
            fragment.appendChild(card);
        }

        this.shelfGrid.appendChild(fragment);
    }
    
    async deleteBook(id) {
        if (confirm("Are you sure you want to delete this book? This deletes all associated bookmarks, notes, and highlights.")) {
            await DbManager.deleteBook(id);
            this.showToast("Book deleted");
            this.loadShelf();
        }
    }

    /* ==========================================================================
       8. READER ENGINE RENDERERS
       ========================================================================== */
    async openBook(bookId) {
        this.currentBook = await DbManager.getBook(bookId);
        if (!this.currentBook) return;
        
        // Hide dashboard, show reader
        this.dashboardView.classList.remove("active");
        this.readerView.style.display = "flex";
        this.readerView.classList.add("active");
        
        this.readerBookTitle.innerText = this.currentBook.title;
        this.readerBookAuthor.innerText = this.currentBook.author;
        
        // Clear old viewers
        this.epubViewer.style.display = "none";
        this.epubViewer.innerHTML = "";
        this.pdfViewer.style.display = "none";
        this.pdfViewer.innerHTML = "";
        this.customViewer.style.display = "none";
        this.customContent.innerHTML = "";
        
        // Set layout based on screen size and persisted preferences
        const isDesktop = window.innerWidth >= 768;
        const useSplit = isDesktop && this.splitView;
        this.viewerContainer.className = `viewer-container ${useSplit ? 'split-layout' : 'single-layout'}`;
        this.splitViewBtn.classList.toggle("active", useSplit);
        
        // Start Analytics timer
        this.startTimer();
        
        // Load notes/bookmarks sidebars
        this.loadBookmarksList();
        this.loadNotesList();
        
        // Reset Search
        document.getElementById("inbook-search-input").value = "";
        document.getElementById("search-results-list").innerHTML = "";
        
        // Read file depending on type
        const format = this.currentBook.format;
        const progress = await DbManager.getProgress(bookId);
        
        // Toggle PDF customization controls and helper note
        const pdfNote = document.getElementById("pdf-customization-note");
        const fontFamilySelect = document.getElementById("font-family-select");
        const lhDec = document.getElementById("line-height-dec");
        const lhInc = document.getElementById("line-height-inc");
        const marginBtns = document.querySelectorAll(".margin-btn");

        if (format === 'pdf') {
            if (pdfNote) pdfNote.style.display = "flex";
            if (fontFamilySelect) fontFamilySelect.disabled = true;
            if (lhDec) lhDec.disabled = true;
            if (lhInc) lhInc.disabled = true;
            marginBtns.forEach(b => b.disabled = true);
        } else {
            if (pdfNote) pdfNote.style.display = "none";
            if (fontFamilySelect) fontFamilySelect.disabled = false;
            if (lhDec) lhDec.disabled = false;
            if (lhInc) lhInc.disabled = false;
            marginBtns.forEach(b => b.disabled = false);
        }

        if (format === 'epub') {
            this.renderEpub(this.currentBook.content, progress);
        } else if (format === 'pdf') {
            this.renderPdf(this.currentBook.content, progress);
        } else if (format === 'mobi') {
            // MOBI bodies are raw HTML — sanitize before it reaches innerHTML.
            const parsed = MobiParser.parse(this.currentBook.content, this.currentBook.title);
            this.renderCustomContent(sanitizeHtml(parsed.content), progress);
        } else if (format === 'txt') {
            this.renderCustomContent(this.currentBook.content, progress);
        }
        
        // Update bookmark icon
        this.updateBookmarkIcon();
    }
    
    exitReader() {
        if (this.isSpeaking) this.stopTTS();
        this.stopTimer();
        
        // Save final progress
        this.saveCurrentProgress().then(() => {
            this.readerView.style.display = "none";
            this.readerView.classList.remove("active");
            this.dashboardView.classList.add("active");

            // Clean references (release the multi-MB file buffer for GC)
            this.epubBook = null;
            this.epubRendition = null;
            this.pdfDoc = null;
            this.currentBook = null;
            if (this.pdfObserver) {
                this.pdfObserver.disconnect();
                this.pdfObserver = null;
            }

            // Reset customization note & controls on exit
            const pdfNote = document.getElementById("pdf-customization-note");
            const fontFamilySelect = document.getElementById("font-family-select");
            const lhDec = document.getElementById("line-height-dec");
            const lhInc = document.getElementById("line-height-inc");
            const marginBtns = document.querySelectorAll(".margin-btn");
            if (pdfNote) pdfNote.style.display = "none";
            if (fontFamilySelect) fontFamilySelect.disabled = false;
            if (lhDec) lhDec.disabled = false;
            if (lhInc) lhInc.disabled = false;
            marginBtns.forEach(b => b.disabled = false);

            this.loadShelf();
        });
    }

    // EPUB Render Logic
    renderEpub(arrayBuffer, progress) {
        this.epubViewer.style.display = "block";

        this.epubBook = ePub(arrayBuffer);
        const isDesktop = window.innerWidth >= 768;
        const useSplit = isDesktop && this.splitView;
        this.epubRendition = this.epubBook.renderTo("epub-viewer", {
            width: "100%",
            height: "100%",
            flow: "paginated",          // Kindle-style page turns (columns), not a long scroll
            spread: useSplit ? "always" : "none",             // two-column vs single page
            manager: "default",
            allowScriptedContent: false // never run scripts embedded in a book
        });

        // Inject our web fonts INTO each chapter iframe (epub renders in sandboxed
        // documents that don't inherit the page's fonts) so Fraunces/Inter/etc.
        // actually render instead of falling back. addStylesheet() is a real
        // epub.js Contents method (unlike the old, non-existent addStyle()).
        const FONT_CSS = "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,400..500&family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,400&display=swap";
        this.epubRendition.hooks.content.register((contents) => {
            try { contents.addStylesheet(FONT_CSS); } catch (e) { /* offline: graceful fallback */ }
            // Force re-apply current custom reader settings on section load
            setTimeout(() => this.applyEpubStyles(), 100);
        });

        // Apply the current typography theme BEFORE first paint so the book never
        // flashes its publisher defaults.
        this.applyEpubStyles();

        // Handle loading position
        const targetPos = progress ? progress.position : undefined;
        this.epubRendition.display(targetPos).then(() => {
            setTimeout(() => {
                if (this.epubRendition && this.epubRendition.manager) this.epubRendition.resize();
            }, 150);
        });
        
        // In-book highlights selections
        this.epubRendition.on("selected", (cfiRange, contents) => {
            this.selectedEpubCfi = cfiRange;
            this.selectedText = contents.window.getSelection().toString();
            
            // Get coordinates relative to iframe
            const iframe = this.epubViewer.querySelector("iframe");
            const rects = contents.window.getSelection().getRangeAt(0).getBoundingClientRect();
            const iframeRect = iframe.getBoundingClientRect();
            
            const left = rects.left + iframeRect.left + this.viewerContainer.scrollLeft;
            const top = rects.top + iframeRect.top - 45 + this.viewerContainer.scrollTop;
            
            this.showTooltipAt(left, top);
        });
        
        // Load Table of Contents
        this.epubBook.loaded.navigation.then(nav => {
            const tocList = document.getElementById("toc-list");
            tocList.innerHTML = "";
            
            nav.forEach(chapter => {
                const li = document.createElement("li");
                li.innerText = chapter.label;
                li.addEventListener("click", () => {
                    this.epubRendition.display(chapter.href);
                });
                tocList.appendChild(li);
            });
        });
        
        // Apply initial styles
        this.epubBook.ready.then(() => {
            if (this.epubRendition && this.epubRendition.manager) {
                this.epubRendition.resize();
            }
            this.applyEpubStyles();
            this.loadEpubHighlights();
        });
        
        // Progress hook
        this.epubRendition.on("relocated", (location) => {
            const pct = location.start.percentage;
            this.readingProgressText.innerText = `Location: ${Math.round(pct * 100)}%`;
            this.updateBookmarkIcon();
            this.saveCurrentProgress();
        });
    }
    
    // Resolve the current reading palette (shared by EPUB themes + helpers).
    readingPalette() {
        switch (this.activeTheme) {
            case 'light': return { bg: '#ffffff', text: '#1a1a1a', accent: '#2563eb', codeBg: '#f3f4f6', sel: 'rgba(37,99,235,0.22)' };
            case 'sepia': return { bg: '#f4ecd8', text: '#433422', accent: '#8d5b4c', codeBg: '#e2cca6', sel: 'rgba(141,91,76,0.30)' };
            case 'dark':  return { bg: '#1a1a1a', text: '#e0e0e0', accent: '#3b82f6', codeBg: '#2d2d2d', sel: 'rgba(59,130,246,0.35)' };
            case 'black': return { bg: '#000000', text: '#d8d8d8', accent: '#e2b266', codeBg: '#161616', sel: 'rgba(226,178,102,0.32)' };
            default:      return { bg: '#faf9f5', text: '#222222', accent: '#b30000', codeBg: '#eae7db', sel: 'rgba(179,0,0,0.20)' };
        }
    }

    // Apply fonts / size / spacing / margins / theme to the EPUB via epub.js's
    // Themes API (the supported, Kindle-grade path). The old code called a
    // non-existent contents.addStyle(), so NO option ever reached the book.
    applyEpubStyles(fontFamilyOverride) {
        if (!this.epubRendition || !this.epubRendition.themes) return;

        // Apply margins to the parent #epub-viewer container instead of the iframe body
        const container = document.getElementById("epub-viewer");
        if (container) {
            const width = this.margin === 'narrow' ? '96%' : this.margin === 'wide' ? '70%' : '86%';
            container.style.width = width;
            container.style.minWidth = "0"; // bypass .viewer-engine min-width
            container.style.maxWidth = "100%";
            container.style.margin = "0 auto";
        }

        const selectedFont = fontFamilyOverride || document.getElementById("font-family-select").value || 'Georgia';
        const epubFontName = selectedFont.split(',')[0].replace(/['"]/g, '').trim();
        let fontFamily;
        if (epubFontName === 'Inter' || epubFontName === 'system-ui') {
            fontFamily = `${epubFontName}, sans-serif`;
        } else if (epubFontName === 'Fira Code') {
            fontFamily = `'${epubFontName}', monospace`;
        } else {
            fontFamily = `'${epubFontName}', Georgia, serif`;
        }

        const fontPct = `${this.fontSize}%`;
        const lh = String(this.lineHeight);
        const p = this.readingPalette();
        const padding = '0 24px'; // Clean fixed padding inside the iframe

        // Full element-level rules (headings accent, code, quotes, justified body).
        const rules = {
            'html': { 'background': `${p.bg} !important` },
            'body': {
                'font-family': `${fontFamily} !important`,
                'line-height': `${lh} !important`,
                'background': `${p.bg} !important`,
                'color': `${p.text} !important`,
                'padding': `${padding} !important`,
                '-webkit-hyphens': 'auto', 'hyphens': 'auto'
            },
            'p, li, span, a, div, td, blockquote': {
                'font-family': `${fontFamily} !important`,
                'color': `${p.text} !important`,
                'line-height': `${lh} !important`
            },
            'p, li': {
                'text-align': 'justify !important'
            },
            'h1, h2, h3, h4, h5, h6': { 'color': `${p.accent} !important`, 'font-family': "'Fraunces', Georgia, serif !important", 'line-height': '1.2 !important' },
            'a': { 'color': `${p.accent} !important` },
            'pre, code, pre *, code *': { 'font-family': "'Fira Code', monospace !important", 'background': `${p.codeBg} !important`, 'color': `${p.text} !important` },
            'pre': { 'padding': '12px !important', 'border-left': `3px solid ${p.accent} !important`, 'border-radius': '4px', 'overflow-x': 'auto' },
            'code': { 'padding': '2px 4px !important', 'border-radius': '3px' },
            'blockquote': { 'border-left': `3px solid ${p.accent} !important`, 'padding-left': '15px !important', 'font-style': 'italic !important', 'opacity': '0.85 !important' },
            'img, svg': { 'max-width': '100% !important', 'height': 'auto !important' },
            '::selection': { 'background': p.sel }
        };

        const themes = this.epubRendition.themes;

        // Register/refresh a named theme + select it (covers element-level rules
        // for newly loaded chapters).
        try {
            themes.register('anyreader', rules);
            themes.select('anyreader');
            if (typeof themes.update === 'function') themes.update('anyreader');
        } catch (e) { console.warn('epub theme register failed', e); }

        // Body-level overrides apply LIVE to already-rendered chapters (this is what
        // makes the controls feel instant, like Kindle).
        try {
            themes.fontSize(fontPct);
            themes.font(epubFontName);
            themes.override('color', p.text, true);
            themes.override('background', p.bg, true);
            themes.override('line-height', lh, true);
            themes.override('padding', padding, true);
        } catch (e) { console.warn('epub theme override failed', e); }

        // Live DOM Injection: Injects a high-specificity style element into each iframe head
        // to guarantee that O'Reilly formatting controls bypass hardcoded publisher style rules.
        try {
            if (this.epubRendition.views()) {
                this.epubRendition.views().forEach(view => {
                    if (view.contents && view.contents.document) {
                        const doc = view.contents.document;
                        let customStyle = doc.getElementById("anyreader-override-styles");
                        if (!customStyle) {
                            customStyle = doc.createElement("style");
                            customStyle.id = "anyreader-override-styles";
                            doc.head.appendChild(customStyle);
                        }
                        customStyle.textContent = `
                            html { background: ${p.bg} !important; }
                            body {
                                font-family: ${fontFamily} !important;
                                font-size: ${fontPct} !important;
                                line-height: ${lh} !important;
                                background: ${p.bg} !important;
                                color: ${p.text} !important;
                                padding: ${padding} !important;
                            }
                            p, li, span, a, div, td, blockquote { 
                                font-family: ${fontFamily} !important;
                                color: ${p.text} !important; 
                                font-size: 1em !important; 
                                line-height: ${lh} !important;
                            }
                            p, li {
                                text-align: justify !important;
                            }
                            h1, h2, h3, h4, h5, h6 { 
                                color: ${p.accent} !important; 
                                font-family: 'Playfair Display', Georgia, serif !important;
                            }
                            pre, code, pre *, code * { 
                                font-family: 'Fira Code', monospace !important; 
                                background-color: ${p.codeBg} !important; 
                                color: ${p.text} !important; 
                            }
                            pre { 
                                padding: 12px !important; 
                                border-left: 3px solid ${p.accent} !important; 
                                border-radius: 4px !important; 
                                overflow-x: auto !important; 
                            }
                            code { padding: 2px 4px !important; border-radius: 3px !important; }
                            blockquote { 
                                border-left: 3px solid ${p.accent} !important; 
                                padding-left: 15px !important; 
                                font-style: italic !important; 
                                opacity: 0.85 !important; 
                            }
                            img, svg { max-width: 100% !important; height: auto !important; }
                        `;
                    }
                });
            }
        } catch (err) {
            console.warn("Direct live override injection failed", err);
        }

        // Force Epub.js to re-measure and layout columns correctly after style adjustments
        if (this.epubRendition && this.epubRendition.manager) {
            const currentCfi = this.epubRendition.location?.start?.cfi;
            this.epubRendition.resize();
            if (currentCfi) {
                setTimeout(() => {
                    if (this.epubRendition) {
                        this.epubRendition.display(currentCfi);
                    }
                }, 80);
            }
        }
    }
    
    async loadEpubHighlights() {
        if (!this.currentBook || !this.epubRendition) return;
        const notes = await DbManager.getNotes(this.currentBook.id);
        notes.forEach(note => {
            if (note.cfiRange) {
                this.epubRendition.annotations.add("highlight", note.cfiRange, {}, () => {}, `highlight-node ${note.color}`);
            }
        });
    }

    // PDF Render Logic
    async renderPdf(arrayBuffer, progress) {
        this.pdfViewer.style.display = "flex";
        
        this.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        this.pdfNumPages = this.pdfDoc.numPages;
        this.pdfCurrentPage = progress ? parseInt(progress.position) || 1 : 1;
        
        this.readingProgressText.innerText = `Page ${this.pdfCurrentPage} of ${this.pdfNumPages}`;
        
        // Build empty scroll layout containers for lazy rendering
        const tocList = document.getElementById("toc-list");
        tocList.innerHTML = "";
        
        // 1. Get first page size for rendering shell boundaries
        const firstPage = await this.pdfDoc.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1 });
        const aspectRatio = viewport.width / viewport.height;
        this.pdfAspect = aspectRatio;                 // remembered for zoom re-layout
        // PDF zoom follows the global size control (clamped to a sane range).
        this.pdfZoom = Math.max(0.7, Math.min(2.5, this.fontSize / 100));

        // 2. Build shell nodes
        for (let i = 1; i <= this.pdfNumPages; i++) {
            const pageDiv = document.createElement("div");
            pageDiv.className = "pdf-page-container";
            pageDiv.id = `pdf-page-node-${i}`;
            pageDiv.dataset.pageNum = i;

            // Adjust width based on viewer bounds × zoom
            const base = Math.min(900, this.viewerContainer.clientWidth - 100);
            const viewerWidth = Math.max(280, base * this.pdfZoom);
            pageDiv.style.width = `${viewerWidth}px`;
            pageDiv.style.height = `${viewerWidth / aspectRatio}px`;
            pageDiv.style.position = "relative";

            this.pdfViewer.appendChild(pageDiv);
            
            // Populate ToC with Page shortcuts
            const li = document.createElement("li");
            li.innerText = `Page ${i}`;
            li.addEventListener("click", () => {
                pageDiv.scrollIntoView({ behavior: 'smooth' });
            });
            tocList.appendChild(li);
        }
        
        // 3. Setup IntersectionObserver to trigger page rendering on scroll visibility
        this.pdfObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const pageNum = parseInt(entry.target.dataset.pageNum);
                if (entry.isIntersecting) {
                    this.renderPdfPage(pageNum, entry.target);

                    // Update reading progress based on currently visible page
                    this.pdfCurrentPage = pageNum;
                    this.readingProgressText.innerText = `Page ${this.pdfCurrentPage} of ${this.pdfNumPages}`;
                    this.updateBookmarkIcon();
                    this.saveCurrentProgress();
                } else if (Math.abs(pageNum - this.pdfCurrentPage) > 3) {
                    // Recycle pages far from the viewport to cap canvas memory.
                    this.unrenderPdfPage(entry.target);
                }
            });
        }, {
            root: this.viewerContainer,
            threshold: 0.15 // visible when 15% in screen bounds
        });
        
        // Observe all page nodes
        this.pdfViewer.querySelectorAll(".pdf-page-container").forEach(node => {
            this.pdfObserver.observe(node);
        });
        
        // Scroll directly to progress position
        setTimeout(() => {
            const targetNode = document.getElementById(`pdf-page-node-${this.pdfCurrentPage}`);
            if (targetNode) targetNode.scrollIntoView();
        }, 150);
    }
    
    // Dynamic rendering of PDF page to canvas & text layer overlays
    async renderPdfPage(pageNum, container) {
        if (container.dataset.rendered === "true") return;
        container.dataset.rendered = "true";
        
        const page = await this.pdfDoc.getPage(pageNum);
        
        // Calculate viewport sizing (CSS pixels; reused by the text layer)
        const containerWidth = parseFloat(container.style.width);
        const normalViewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / normalViewport.width;
        const viewport = page.getViewport({ scale: scale });

        // Render Canvas at devicePixelRatio for crisp output on HiDPI/Retina,
        // downscaled to CSS size via style width/height.
        const dpr = window.devicePixelRatio || 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext("2d");
        container.appendChild(canvas);

        const renderContext = {
            canvasContext: context,
            viewport: viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
        };
        await page.render(renderContext).promise;

        // Render Selectable Text Layer overlay
        const textContent = await page.getTextContent();
        const textLayerDiv = document.createElement("div");
        textLayerDiv.className = "textLayer";
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.style.position = "absolute";
        textLayerDiv.style.top = "0";
        textLayerDiv.style.left = "0";
        textLayerDiv.style.overflow = "hidden";
        textLayerDiv.style.opacity = "0.3"; // standard transparent positioning
        // pdf.js >=3 positions text spans relative to this CSS variable.
        textLayerDiv.style.setProperty("--scale-factor", viewport.scale);

        container.appendChild(textLayerDiv);

        const textLayerTask = pdfjsLib.renderTextLayer({
            textContent: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
        });

        // Release pdf.js per-page caches once both canvas and text layer are done.
        const done = textLayerTask && textLayerTask.promise ? textLayerTask.promise : Promise.resolve();
        done.catch(() => {}).finally(() => {
            if (typeof page.cleanup === "function") page.cleanup();
        });
    }

    // Free an off-screen PDF page's canvas + text layer; it re-renders lazily on scroll-back.
    unrenderPdfPage(container) {
        if (container.dataset.rendered !== "true") return;
        container.querySelectorAll("canvas, .textLayer").forEach(n => n.remove());
        container.dataset.rendered = "";
    }

    // Re-layout PDF page shells at the current zoom and force a re-render. Driven by
    // the +/- size controls so the font-size buttons act as a zoom for fixed-layout PDFs.
    applyPdfZoom() {
        if (!this.pdfDoc || !this.pdfAspect) return;
        const base = Math.min(900, this.viewerContainer.clientWidth - 100);
        const width = Math.max(280, base * this.pdfZoom);
        const anchor = this.pdfCurrentPage;
        this.pdfViewer.querySelectorAll(".pdf-page-container").forEach((node) => {
            node.style.width = `${width}px`;
            node.style.height = `${width / this.pdfAspect}px`;
            this.unrenderPdfPage(node); // clear so the observer re-renders crisply at the new size
        });
        const target = document.getElementById(`pdf-page-node-${anchor}`);
        if (target) {
            this.renderPdfPage(anchor, target);
            target.scrollIntoView({ block: 'start' });
        }
    }

    // Reflowable Custom Contents (MOBI text parser outputs / TXT files)
    renderCustomContent(htmlString, progress) {
        this.customViewer.style.display = "block";
        this.customContent.innerHTML = htmlString;
        
        // Format ToC
        const tocList = document.getElementById("toc-list");
        tocList.innerHTML = "";
        
        const headings = this.customContent.querySelectorAll("h1, h2, h3");
        if (headings.length > 0) {
            headings.forEach((heading, idx) => {
                if (!heading.id) heading.id = `heading-node-${idx}`;
                const li = document.createElement("li");
                li.innerText = heading.innerText;
                li.addEventListener("click", () => {
                    heading.scrollIntoView({ behavior: 'smooth' });
                });
                tocList.appendChild(li);
            });
        } else {
            // Build fallback page blocks
            const li = document.createElement("li");
            li.innerText = "Cover Page";
            li.addEventListener("click", () => this.viewerContainer.scrollTop = 0);
            tocList.appendChild(li);
        }
        
        // Restore progress scroll top
        if (progress && progress.position) {
            setTimeout(() => {
                this.viewerContainer.scrollTop = parseFloat(progress.position);
            }, 100);
        }

        // NOTE: scroll progress tracking is bound ONCE in bindEvents (not here),
        // so re-rendering (book open, note delete) never stacks listeners.

        this.applyCustomStyles();
        this.loadCustomHighlights();
    }
    
    applyCustomStyles(fontFamilyOverride) {
        const root = document.documentElement;
        
        // Apply variables to styling scope
        const selectedFont = fontFamilyOverride || document.getElementById("font-family-select").value || 'Georgia';
        const epubFontName = selectedFont.split(',')[0].replace(/['"]/g, '').trim();
        let fontFamily;
        if (epubFontName === 'Inter' || epubFontName === 'system-ui') {
            fontFamily = `${epubFontName}, sans-serif`;
        } else if (epubFontName === 'Fira Code') {
            fontFamily = `'${epubFontName}', monospace`;
        } else {
            fontFamily = `'${epubFontName}', Georgia, serif`;
        }

        root.style.setProperty('--reader-font-family', fontFamily);
        root.style.setProperty('--reader-font-size', `${this.fontSize}%`);
        root.style.setProperty('--reader-line-height', this.lineHeight);
        
        const maxWidth = this.margin === 'narrow' ? '100%' : this.margin === 'wide' ? '600px' : '780px';
        root.style.setProperty('--max-page-width', maxWidth);
    }
    
    async loadCustomHighlights() {
        if (!this.currentBook) return;
        const notes = await DbManager.getNotes(this.currentBook.id);
        notes.forEach(note => {
            if (note.startOffset && note.endOffset && note.nodeIndex !== undefined) {
                this.applyCustomHtmlHighlight(note);
            }
        });
    }
    
    applyCustomHtmlHighlight(note) {
        // Simple DOM highlighter
        const paragraphs = this.customContent.querySelectorAll("p, li, blockquote");
        const node = paragraphs[note.nodeIndex];
        if (!node) return;

        try {
            const html = node.innerHTML;
            const hlText = note.quote;
            const colorClass = ['yellow', 'green', 'blue', 'pink'].includes(note.color) ? note.color : 'yellow';

            // Build the wrapper with escaped quote text; use a function replacement so
            // any "$" sequences in the quote are treated literally (no $& pitfalls).
            const replaceStr = `<span class="highlight-node ${colorClass}" data-note-id="${note.id}">${escapeHtml(hlText)}</span>`;
            node.innerHTML = html.replace(hlText, () => replaceStr);

            // Click to read note details
            const spanNode = node.querySelector(`[data-note-id="${note.id}"]`);
            if (spanNode && note.body) {
                spanNode.addEventListener("click", () => {
                    this.showToast(`Note: ${note.body}`);
                });
            }
        } catch (e) {
            console.warn("Failed rendering HTML highlight node", e);
        }
    }

    /* ==========================================================================
       9. NAVIGATIONAL PROGRESS SAVING & PAGE TURNING
       ========================================================================== */
    async saveCurrentProgress() {
        if (!this.currentBook) return;
        
        let position = "0";
        let percentage = 0;
        
        if (this.currentBook.format === 'epub' && this.epubRendition) {
            const loc = this.epubRendition.currentLocation();
            if (loc && loc.start) {
                position = loc.start.cfi;
                percentage = loc.start.percentage || 0;
            }
        } else if (this.currentBook.format === 'pdf') {
            position = this.pdfCurrentPage.toString();
            percentage = this.pdfNumPages > 0 ? (this.pdfCurrentPage / this.pdfNumPages) : 0;
        } else {
            // MOBI or TXT
            position = this.viewerContainer.scrollTop.toString();
            const total = this.viewerContainer.scrollHeight - this.viewerContainer.clientHeight;
            percentage = total > 0 ? (this.viewerContainer.scrollTop / total) : 0;
        }
        
        const progress = {
            bookId: this.currentBook.id,
            position: position,
            percentage: percentage,
            updated: Date.now()
        };
        
        await DbManager.saveProgress(progress);
    }
    
    prevPage() {
        if (this.isSpeaking) this.stopTTS();
        if (this.currentBook.format === 'epub' && this.epubRendition) {
            this.epubRendition.prev();
        } else if (this.currentBook.format === 'pdf') {
            const targetPage = Math.max(1, this.pdfCurrentPage - 1);
            const targetNode = document.getElementById(`pdf-page-node-${targetPage}`);
            if (targetNode) targetNode.scrollIntoView({ behavior: 'smooth' });
        } else {
            // MOBI/TXT - if column view scroll horizontally, else scroll page height
            if (this.splitView) {
                this.viewerContainer.scrollLeft -= this.viewerContainer.clientWidth;
            } else {
                this.viewerContainer.scrollTop -= this.viewerContainer.clientHeight * 0.85;
            }
        }
    }
    
    nextPage() {
        if (this.isSpeaking) this.stopTTS();
        if (this.currentBook.format === 'epub' && this.epubRendition) {
            this.epubRendition.next();
        } else if (this.currentBook.format === 'pdf') {
            const targetPage = Math.min(this.pdfNumPages, this.pdfCurrentPage + 1);
            const targetNode = document.getElementById(`pdf-page-node-${targetPage}`);
            if (targetNode) targetNode.scrollIntoView({ behavior: 'smooth' });
        } else {
            if (this.splitView) {
                this.viewerContainer.scrollLeft += this.viewerContainer.clientWidth;
            } else {
                this.viewerContainer.scrollTop += this.viewerContainer.clientHeight * 0.85;
            }
        }
    }
    
    toggleSplitView() {
        this.splitView = !this.splitView;
        this.saveSettings();
        
        const isDesktop = window.innerWidth >= 768;
        const useSplit = isDesktop && this.splitView;
        this.splitViewBtn.classList.toggle("active", useSplit);
        
        if (this.currentBook.format === 'epub' && this.epubRendition) {
            this.epubRendition.spread(useSplit ? "always" : "none");
            if (this.epubRendition.manager) {
                this.epubRendition.resize();
            }
        } else {
            // For MOBI or TXT formatting
            this.viewerContainer.classList.toggle("split-layout", useSplit);
            this.applyCustomStyles();
        }
    }
    
    toggleStylePanel(show) {
        this.stylePanel.style.display = show ? "flex" : "none";
    }

    /* ==========================================================================
       10. TYPOGRAPHY SETTINGS INTERFACE
       ========================================================================== */
    setTheme(themeName) {
        this.activeTheme = themeName;

        // Remove old theme class lists
        document.body.className = document.body.className.replace(/\btheme-\S+/g, '');
        document.body.classList.add(`theme-${themeName}`);

        // Keep the style-panel swatch highlight in sync no matter how the theme changed.
        document.querySelectorAll(".theme-opt").forEach(o =>
            o.classList.toggle("active", o.dataset.theme === themeName));

        // Propagate themes inside readers
        if (this.epubRendition) {
            this.applyEpubStyles();
        }

        // Update selection tooltip theme
        this.selectionTooltip.style.borderColor = `var(--reader-border)`;
        this.saveSettings();
    }

    setFontFamily(fontVal) {
        const sel = document.getElementById("font-family-select");
        if (sel && fontVal) {
            const cleanFont = fontVal.split(',')[0].replace(/['"]/g, '').trim();
            const hasOption = Array.from(sel.options).some(opt => opt.value === cleanFont);
            if (hasOption) {
                sel.value = cleanFont;
            } else {
                sel.value = cleanFont;
            }
        }

        if (this.epubRendition) {
            this.applyEpubStyles(fontVal);
        } else {
            this.applyCustomStyles(fontVal);
        }
        this.saveSettings();
    }

    adjustFontSize(delta) {
        this.fontSize = Math.max(70, Math.min(250, this.fontSize + delta));
        document.getElementById("font-size-val").innerText = `${this.fontSize}%`;

        const fmt = this.currentBook && this.currentBook.format;
        if (fmt === 'epub' && this.epubRendition) {
            this.applyEpubStyles();
        } else if (fmt === 'pdf') {
            // The size control doubles as a zoom for fixed-layout PDFs.
            this.pdfZoom = this.fontSize / 100;
            this.applyPdfZoom();
        } else {
            this.applyCustomStyles();
        }
        this.saveSettings();
    }

    adjustLineHeight(delta) {
        this.lineHeight = Math.max(1.1, Math.min(2.5, parseFloat((this.lineHeight + delta).toFixed(1))));
        document.getElementById("line-height-val").innerText = this.lineHeight;

        if (this.epubRendition) {
            this.applyEpubStyles();
        } else {
            this.applyCustomStyles();
        }
        this.saveSettings();
    }

    setMargin(marginType) {
        this.margin = marginType;
        if (this.epubRendition) {
            this.applyEpubStyles();
        } else {
            this.applyCustomStyles();
        }
        this.saveSettings();
    }

    setupThemes() {
        // Sync setting swatches
        this.setTheme(this.activeTheme);
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen()
                .then(() => this.fullscreenBtn.innerHTML = `<i class="fa-solid fa-compress"></i>`)
                .catch(err => this.showToast("Fullscreen unavailable"));
        } else {
            document.exitFullscreen()
                .then(() => this.fullscreenBtn.innerHTML = `<i class="fa-solid fa-expand"></i>`);
        }
    }

    /* ==========================================================================
       11. HIGHLIGHTS & NOTE ANNOTATION SYSTEM
       ========================================================================== */
    handleTextSelection(e) {
        if (this.currentBook && this.currentBook.format === 'epub') return; // Handled internally by epub rendition
        
        const selection = window.getSelection();
        if (selection.isCollapsed || selection.rangeCount === 0) {
            this.selectionTooltip.classList.remove("active");
            return;
        }
        
        const range = selection.getRangeAt(0);
        
        // Ensure selection context is within the reader canvas container
        if (!this.customContent.contains(range.commonAncestorContainer) && 
            !this.pdfViewer.contains(range.commonAncestorContainer)) {
            this.selectionTooltip.classList.remove("active");
            return;
        }
        
        this.selectedText = selection.toString().trim();
        this.selectedRange = range.cloneRange();
        
        // Position Selection float tooltip
        const rect = range.getBoundingClientRect();
        this.showTooltipAt(rect.left + window.scrollX, rect.top + window.scrollY - 45);
    }
    
    showTooltipAt(left, top) {
        this.selectionTooltip.style.left = `${left}px`;
        this.selectionTooltip.style.top = `${top}px`;
        this.selectionTooltip.classList.add("active");
    }
    
    clearSelection() {
        this.selectionTooltip.classList.remove("active");
        window.getSelection().removeAllRanges();
        this.selectedText = "";
        this.selectedRange = null;
        this.selectedEpubCfi = null;
    }
    
    async addHighlight(colorName) {
        if (!this.currentBook) return;
        
        const note = {
            bookId: this.currentBook.id,
            quote: this.selectedText,
            body: "", // empty note, highlighting only
            color: colorName,
            cfiRange: this.selectedEpubCfi,
            date: Date.now()
        };
        
        // Capture matching paragraph node offset if custom HTML viewer is active
        if (!this.selectedEpubCfi && this.currentBook.format !== 'pdf') {
            const nodeDetails = this.findSelectionNodeIndex(this.selectedRange);
            if (nodeDetails) {
                note.nodeIndex = nodeDetails.nodeIndex;
                note.startOffset = nodeDetails.startOffset;
                note.endOffset = nodeDetails.endOffset;
            }
        }
        
        // Save note
        const noteId = await DbManager.saveNote(note);
        note.id = noteId;
        
        // Render highlighting node immediately on view Canvas
        if (this.currentBook.format === 'epub' && this.epubRendition) {
            this.epubRendition.annotations.add("highlight", this.selectedEpubCfi, {}, () => {}, `highlight-node ${colorName}`);
        } else if (this.currentBook.format !== 'pdf') {
            this.applyCustomHtmlHighlight(note);
        }
        
        this.showToast("Highlight added");
        this.clearSelection();
        this.loadNotesList();
    }
    
    findSelectionNodeIndex(range) {
        if (!range) return null;
        // Identify matching index of the selected paragraph node inside customContent
        const paragraphs = this.customContent.querySelectorAll("p, li, blockquote");
        let parentNode = range.startContainer;
        while (parentNode && parentNode.nodeName !== "P" && parentNode.nodeName !== "LI" && parentNode.nodeName !== "BLOCKQUOTE") {
            parentNode = parentNode.parentNode;
        }
        
        if (!parentNode) return null;
        
        const nodeIndex = Array.from(paragraphs).indexOf(parentNode);
        if (nodeIndex === -1) return null;
        
        return {
            nodeIndex: nodeIndex,
            startOffset: range.startOffset,
            endOffset: range.endOffset
        };
    }
    
    openNoteModal() {
        this.selectionTooltip.classList.remove("active");
        this.noteQuote.innerText = `"${this.selectedText}"`;
        this.noteTextarea.value = "";
        this._lastTrigger = document.activeElement;
        this.noteModal.classList.add("active");
        // Move focus into the dialog for keyboard users.
        setTimeout(() => this.noteTextarea.focus(), 0);
    }

    // Restore focus to whatever opened the most recent modal.
    _restoreFocus() {
        if (this._lastTrigger && typeof this._lastTrigger.focus === "function") {
            this._lastTrigger.focus();
        }
        this._lastTrigger = null;
    }

    async saveNote() {
        if (!this.currentBook) return;
        const text = this.noteTextarea.value.trim();
        if (!text) {
            this.showToast("Note cannot be empty");
            return;
        }
        
        const note = {
            bookId: this.currentBook.id,
            quote: this.selectedText,
            body: text,
            color: "yellow",
            cfiRange: this.selectedEpubCfi,
            date: Date.now()
        };
        
        if (!this.selectedEpubCfi && this.currentBook.format !== 'pdf') {
            const nodeDetails = this.findSelectionNodeIndex(this.selectedRange);
            if (nodeDetails) {
                note.nodeIndex = nodeDetails.nodeIndex;
                note.startOffset = nodeDetails.startOffset;
                note.endOffset = nodeDetails.endOffset;
            }
        }
        
        const noteId = await DbManager.saveNote(note);
        note.id = noteId;
        
        // Style highlights context
        if (this.currentBook.format === 'epub' && this.epubRendition) {
            this.epubRendition.annotations.add("highlight", this.selectedEpubCfi, {}, () => {}, `highlight-node yellow`);
        } else if (this.currentBook.format !== 'pdf') {
            this.applyCustomHtmlHighlight(note);
        }
        
        this.noteModal.classList.remove("active");
        this.showToast("Note Annotation Saved");
        this.clearSelection();
        this._restoreFocus();
        this.loadNotesList();
    }
    
    async loadNotesList() {
        const notesList = document.getElementById("notes-list");
        notesList.innerHTML = "";
        
        if (!this.currentBook) return;
        const notes = await DbManager.getNotes(this.currentBook.id);
        
        if (notes.length === 0) {
            notesList.innerHTML = `<li style="opacity:0.6; text-align:center; padding-top:20px;">No highlights/notes added.</li>`;
            return;
        }
        
        notes.forEach(note => {
            const li = document.createElement("li");
            li.className = "note-item";

            // note.quote/note.body are derived from book content / user input — escape them.
            const colorClass = ['yellow', 'green', 'blue', 'pink'].includes(note.color) ? note.color : 'yellow';
            li.innerHTML = `
                <div class="note-header">
                    <span class="note-hl-preview ${colorClass}">${escapeHtml(note.quote)}</span>
                </div>
                ${note.body ? `<div class="note-body">${escapeHtml(note.body)}</div>` : ''}
                <div class="note-footer">
                    <span>${new Date(note.date).toLocaleDateString()}</span>
                    <button class="note-del-btn" aria-label="Delete note">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                </div>
            `;

            li.querySelector(".note-del-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                this.deleteNote(note.id);
            });

            // Navigate directly to highlight location
            li.addEventListener("click", () => {
                if (this.currentBook.format === 'epub' && this.epubRendition) {
                    this.epubRendition.display(note.cfiRange);
                } else if (this.currentBook.format === 'pdf') {
                    // pdf selection scroll
                } else {
                    const paragraphs = this.customContent.querySelectorAll("p, li, blockquote");
                    const node = paragraphs[note.nodeIndex];
                    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });

            notesList.appendChild(li);
        });
    }
    
    async deleteNote(id) {
        if (!confirm("Delete this highlight/note?")) return;

        const noteId = parseInt(id);

        // Look up the note BEFORE deleting so we can remove the right EPUB annotation.
        const notes = await DbManager.getNotes(this.currentBook.id);
        const target = notes.find(n => n.id === noteId);

        await DbManager.deleteNote(noteId);
        this.showToast("Note deleted");
        this.loadNotesList();

        // Redraw viewer highlights
        if (this.currentBook.format === 'epub') {
            if (this.epubRendition && target && target.cfiRange) {
                this.epubRendition.annotations.remove(target.cfiRange, "highlight");
            }
        } else if (this.currentBook.format !== 'pdf') {
            // Re-render reflowable content (re-parse + sanitize MOBI; TXT is already HTML).
            const progress = await DbManager.getProgress(this.currentBook.id);
            if (this.currentBook.format === 'mobi') {
                const parsed = MobiParser.parse(this.currentBook.content, this.currentBook.title);
                this.renderCustomContent(sanitizeHtml(parsed.content), progress);
            } else {
                this.renderCustomContent(this.currentBook.content, progress);
            }
        }
    }

    /* ==========================================================================
       12. BOOKMARKS SYSTEM
       ========================================================================== */
    async updateBookmarkIcon() {
        if (!this.currentBook) return;
        const progress = await DbManager.getProgress(this.currentBook.id);
        if (!progress || !progress.bookmarks) {
            this.bookmarkToggleBtn.innerHTML = `<i class="fa-regular fa-bookmark"></i>`;
            return;
        }
        
        const loc = progress.position;
        const bookmarked = progress.bookmarks.includes(loc);
        this.bookmarkToggleBtn.innerHTML = bookmarked ? 
            `<i class="fa-solid fa-bookmark" style="color: var(--reader-accent);"></i>` : 
            `<i class="fa-regular fa-bookmark"></i>`;
    }
    
    async toggleBookmark() {
        if (!this.currentBook) return;
        
        let progress = await DbManager.getProgress(this.currentBook.id);
        if (!progress) {
            progress = {
                bookId: this.currentBook.id,
                position: this.currentBook.format === 'epub' ? this.epubRendition.currentLocation().start.cfi : 
                          this.currentBook.format === 'pdf' ? this.pdfCurrentPage.toString() : 
                          this.viewerContainer.scrollTop.toString(),
                percentage: 0,
                bookmarks: []
            };
        }
        
        if (!progress.bookmarks) progress.bookmarks = [];
        
        const loc = progress.position;
        const idx = progress.bookmarks.indexOf(loc);
        
        if (idx > -1) {
            progress.bookmarks.splice(idx, 1);
            this.showToast("Bookmark removed");
        } else {
            progress.bookmarks.push(loc);
            this.showToast("Bookmark saved");
        }
        
        await DbManager.saveProgress(progress);
        this.updateBookmarkIcon();
        this.loadBookmarksList();
    }
    
    async loadBookmarksList() {
        const bookmarksList = document.getElementById("bookmarks-list");
        bookmarksList.innerHTML = "";
        
        if (!this.currentBook) return;
        const progress = await DbManager.getProgress(this.currentBook.id);
        
        if (!progress || !progress.bookmarks || progress.bookmarks.length === 0) {
            bookmarksList.innerHTML = `<li style="opacity:0.6; text-align:center; padding-top:20px;">No bookmarks added.</li>`;
            return;
        }
        
        progress.bookmarks.forEach(bm => {
            const li = document.createElement("li");
            
            // Format printable labels
            let label = "Bookmark Location";
            if (this.currentBook.format === 'pdf') {
                label = `Page ${bm}`;
            } else if (this.currentBook.format !== 'epub') {
                // TXT/MOBI calculate rough scroll percentage
                const val = parseFloat(bm);
                const total = this.viewerContainer.scrollHeight - this.viewerContainer.clientHeight;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                label = `Bookmark spot (${pct}%)`;
            } else {
                label = `Bookmark Spot CFI`;
            }
            
            li.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span><i class="fa-solid fa-bookmark" style="color:var(--reader-accent); margin-right:8px;"></i>${escapeHtml(label)}</span>
                    <button class="note-del-btn" aria-label="Delete bookmark">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;

            li.querySelector(".note-del-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                this.deleteBookmark(bm);
            });

            li.addEventListener("click", () => {
                if (this.currentBook.format === 'epub') {
                    this.epubRendition.display(bm);
                } else if (this.currentBook.format === 'pdf') {
                    const node = document.getElementById(`pdf-page-node-${bm}`);
                    if (node) node.scrollIntoView({ behavior: 'smooth' });
                } else {
                    this.viewerContainer.scrollTop = parseFloat(bm);
                }
            });
            
            bookmarksList.appendChild(li);
        });
    }
    
    async deleteBookmark(bm) {
        if (!this.currentBook) return;
        const progress = await DbManager.getProgress(this.currentBook.id);
        if (progress && progress.bookmarks) {
            const idx = progress.bookmarks.indexOf(bm);
            if (idx > -1) {
                progress.bookmarks.splice(idx, 1);
                await DbManager.saveProgress(progress);
                this.showToast("Bookmark deleted");
                this.updateBookmarkIcon();
                this.loadBookmarksList();
            }
        }
    }

    /* ==========================================================================
       13. FULL TEXT SEARCH ENGINE
       ========================================================================== */

    // Build a highlighted snippet that is HTML-safe: escape the raw text, then
    // wrap matches of the (escaped) query in our own <strong> tags.
    buildSnippet(rawText, query) {
        const safe = escapeHtml(rawText);
        const safeQuery = escapeRegExp(escapeHtml(query));
        if (!safeQuery) return `... ${safe} ...`;
        const re = new RegExp(`(${safeQuery})`, 'gi');
        return `... ${safe.replace(re, '<strong>$1</strong>')} ...`;
    }

    async searchInsideBook() {
        const query = document.getElementById("inbook-search-input").value.trim();
        const resultsList = document.getElementById("search-results-list");
        resultsList.innerHTML = `<li style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</li>`;

        if (!query) {
            resultsList.innerHTML = `<li style="opacity:0.6; text-align:center;">Type a query word to search.</li>`;
            return;
        }

        if (!this.currentBook) return;

        const format = this.currentBook.format;
        let searchResults = [];

        try {
            if (format === 'epub' && this.epubBook) {
                // Epub.js structural search item loop
                const spineQueries = this.epubBook.spine.spineItems.map(item =>
                    item.load(this.epubBook.load.bind(this.epubBook))
                        .then(() => item.find(query))
                        .finally(() => item.unload())
                );
                const rawResults = await Promise.all(spineQueries);
                searchResults = [].concat.apply([], rawResults).map(res => ({
                    target: res.cfi,
                    snippet: this.buildSnippet(res.excerpt || "", query)
                }));
            } else if (format === 'pdf' && this.pdfDoc) {
                // PDF page-by-page text searches
                for (let i = 1; i <= this.pdfNumPages; i++) {
                    const page = await this.pdfDoc.getPage(i);
                    const content = await page.getTextContent();
                    const text = content.items.map(item => item.str).join(' ');

                    let idx = text.toLowerCase().indexOf(query.toLowerCase());
                    while (idx !== -1) {
                        const start = Math.max(0, idx - 30);
                        const end = Math.min(text.length, idx + query.length + 30);

                        searchResults.push({
                            target: i.toString(),
                            snippet: this.buildSnippet(text.slice(start, end), query)
                        });

                        idx = text.toLowerCase().indexOf(query.toLowerCase(), idx + 1);
                    }
                }
            } else {
                // MOBI or TXT raw content searches
                const text = this.customContent.innerText;
                let idx = text.toLowerCase().indexOf(query.toLowerCase());
                while (idx !== -1) {
                    const start = Math.max(0, idx - 30);
                    const end = Math.min(text.length, idx + query.length + 30);

                    searchResults.push({
                        target: idx.toString(),
                        snippet: this.buildSnippet(text.slice(start, end), query)
                    });

                    idx = text.toLowerCase().indexOf(query.toLowerCase(), idx + 1);
                }
            }

            // Render results list
            resultsList.innerHTML = "";
            if (searchResults.length === 0) {
                resultsList.innerHTML = `<li style="opacity:0.6; text-align:center; padding-top:20px;">No matches found for "${escapeHtml(query)}"</li>`;
                return;
            }

            searchResults.forEach(res => {
                const li = document.createElement("li");
                const label = document.createElement("span");
                label.style.cssText = "font-weight:600;color:var(--reader-accent);display:block;font-size:11px;";
                label.textContent = format === 'pdf' ? `Page ${res.target}` : 'Match Found';
                const ctx = document.createElement("span");
                ctx.className = "match-ctx";
                ctx.innerHTML = res.snippet; // pre-escaped, only our own <strong> tags
                li.append(label, ctx);
                li.addEventListener("click", () => {
                    if (format === 'epub') {
                        this.epubRendition.display(res.target);
                    } else if (format === 'pdf') {
                        const targetNode = document.getElementById(`pdf-page-node-${res.target}`);
                        if (targetNode) targetNode.scrollIntoView({ behavior: 'smooth' });
                    } else {
                        // MOBI/TXT match search character offset scroll
                        // Simple approximate search offset finder
                        const queryIndex = parseInt(res.target);
                        // Approximate height placement ratio
                        const charLength = this.customContent.innerText.length;
                        if (charLength > 0) {
                            const ratio = queryIndex / charLength;
                            this.viewerContainer.scrollTop = this.viewerContainer.scrollHeight * ratio - 100;
                        }
                    }
                });
                
                resultsList.appendChild(li);
            });
        } catch (err) {
            console.error(err);
            resultsList.innerHTML = `<li style="color:#ef4444; text-align:center;">Search failed: ${escapeHtml(err.message)}</li>`;
        }
    }

    /* ==========================================================================
       14. ANALYTICS TIMER TRACKER
       ========================================================================== */
    initAnalytics() {
        // Daily Streak Calculator
        const lastReadStr = localStorage.getItem("anyreader_last_read_date");
        const todayStr = new Date().toDateString();
        let streak = parseInt(localStorage.getItem("anyreader_streak") || "0");

        if (lastReadStr) {
            const lastReadDate = new Date(lastReadStr);
            const today = new Date(todayStr);
            const diffTime = Math.abs(today - lastReadDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) {
                // Consecutive streak!
                streak += 1;
                localStorage.setItem("anyreader_streak", streak);
            } else if (diffDays > 1) {
                // Streak broken
                streak = 1;
                localStorage.setItem("anyreader_streak", "1");
            }

            // "Read Today" must reset when the calendar day changes.
            if (lastReadStr !== todayStr) {
                localStorage.setItem("anyreader_time_today", "0");
            }
        } else {
            // First time loading
            streak = 1;
            localStorage.setItem("anyreader_streak", "1");
            localStorage.setItem("anyreader_time_today", "0");
        }
        localStorage.setItem("anyreader_last_read_date", todayStr);
        document.querySelector("#stat-streak .stat-value").innerText = streak;

        // Time Spent Today
        this.updateTimeDisplay();
    }
    
    startTimer() {
        this.readSeconds = 0;
        this.timerInterval = setInterval(() => {
            this.readSeconds += 1;
            
            // Add to localStorage every 10 seconds to persist incremental reads
            if (this.readSeconds % 10 === 0) {
                let accumulated = parseInt(localStorage.getItem("anyreader_time_today") || "0");
                accumulated += 10;
                localStorage.setItem("anyreader_time_today", accumulated);
                this.updateTimeDisplay();
            }
        }, 1000);
    }
    
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
            
            // Add remaining residue
            let accumulated = parseInt(localStorage.getItem("anyreader_time_today") || "0");
            accumulated += (this.readSeconds % 10);
            localStorage.setItem("anyreader_time_today", accumulated);
            this.updateTimeDisplay();
        }
    }
    
    updateTimeDisplay() {
        const totalSecs = parseInt(localStorage.getItem("anyreader_time_today") || "0");
        const mins = Math.round(totalSecs / 60);
        document.getElementById("stats-time-display").innerText = mins === 0 ? "< 1 min" : `${mins} min`;
    }

    /* ==========================================================================
       15. READ ALOUD (TEXT-TO-SPEECH) SYSTEM
       ========================================================================== */
    toggleTTS() {
        if (!('speechSynthesis' in window)) {
            this.showToast("Text-to-Speech not supported in this browser.");
            return;
        }

        if (this.isSpeaking) {
            this.stopTTS();
        } else {
            this.startTTS();
        }
    }

    stopTTS() {
        window.speechSynthesis.cancel();
        this.isSpeaking = false;
        if (this.ttsBtn) {
            this.ttsBtn.innerHTML = `<i class="fa-solid fa-volume-high"></i>`;
            this.ttsBtn.classList.remove("active");
        }
        this.showToast("Speech stopped");
    }

    startTTS() {
        if (!this.currentBook) return;
        let text = "";

        const format = this.currentBook.format;
        if (format === 'epub') {
            const iframe = this.epubViewer.querySelector("iframe");
            if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
                text = iframe.contentDocument.body.innerText;
            }
        } else if (format === 'pdf') {
            const pageContainer = document.getElementById(`pdf-page-node-${this.pdfCurrentPage}`);
            if (pageContainer) {
                const textLayer = pageContainer.querySelector(".textLayer");
                if (textLayer) {
                    text = textLayer.innerText;
                }
            }
        } else {
            text = this.customContent.innerText;
        }

        text = text.replace(/\s+/g, ' ').trim();

        if (!text || text.length < 5) {
            this.showToast("No readable text found.");
            return;
        }

        this.showToast("Reading aloud...");
        this.isSpeaking = true;
        if (this.ttsBtn) {
            this.ttsBtn.innerHTML = `<i class="fa-solid fa-circle-stop" style="color: var(--reader-accent);"></i>`;
            this.ttsBtn.classList.add("active");
        }

        const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
        let currentSentenceIndex = 0;

        const speakNext = () => {
            if (!this.isSpeaking) return;
            if (currentSentenceIndex >= sentences.length) {
                this.stopTTS();
                this.showToast("Finished reading");
                return;
            }

            const sentenceText = sentences[currentSentenceIndex].trim();
            if (!sentenceText) {
                currentSentenceIndex++;
                speakNext();
                return;
            }

            this.speechUtterance = new SpeechSynthesisUtterance(sentenceText);
            const voices = window.speechSynthesis.getVoices();
            this.speechUtterance.voice = voices.find(v => v.lang.startsWith('en')) || voices[0] || null;

            this.speechUtterance.onend = () => {
                currentSentenceIndex++;
                speakNext();
            };

            this.speechUtterance.onerror = (e) => {
                if (e.error !== 'interrupted') {
                    this.stopTTS();
                }
            };

            window.speechSynthesis.speak(this.speechUtterance);
        };

        window.speechSynthesis.cancel();
        speakNext();
    }
}

// Global initialization
window.addEventListener("DOMContentLoaded", () => {
    window.app = new EBookReader();
});
