// Efficient DOM handling
const projectCards = document.querySelectorAll('.project-card');

// Initialize with minimal overhead
document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
    // Single event delegation for all cards
    document.querySelector('.projects-grid').addEventListener('click', handleCardClick);
    
    // Intersection observer for animations
    if ('IntersectionObserver' in window) {
        observeCards();
    }
    
    // Add hover effects efficiently
    addHoverEffects();
}

function handleCardClick(e) {
    const card = e.target.closest('.project-card');
    if (!card) return;
    
    const url = card.dataset.url;
    if (url) {
        // Visual feedback
        card.style.transform = 'scale(0.98)';
        setTimeout(() => {
            window.open(url, '_blank', 'noopener,noreferrer');
            card.style.transform = '';
        }, 100);
    }
}

function observeCards() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { 
        threshold: 0.1,
        rootMargin: '0px 0px -20px 0px'
    });

    projectCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = `opacity 0.6s ease ${index * 0.1}s, transform 0.6s ease ${index * 0.1}s`;
        observer.observe(card);
    });
}

function addHoverEffects() {
    // Use passive listeners for better performance
    projectCards.forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.boxShadow = '0 20px 40px rgba(99, 102, 241, 0.15)';
        }, { passive: true });
        
        card.addEventListener('mouseleave', () => {
            card.style.boxShadow = '';
        }, { passive: true });
    });
}

// Debounced resize handler
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        // Handle any resize-specific logic
        console.log('Layout adjusted');
    }, 250);
}, { passive: true });

// Preload critical resources
const linkPreload = document.createElement('link');
linkPreload.rel = 'preload';
linkPreload.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
linkPreload.as = 'style';
document.head.appendChild(linkPreload);
