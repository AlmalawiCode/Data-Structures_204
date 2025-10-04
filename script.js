// Toggle solution visibility
function toggleSolution(solutionId) {
    const solution = document.getElementById(solutionId);
    const button = event.target;

    if (solution.classList.contains('hidden')) {
        solution.classList.remove('hidden');
        button.textContent = 'Hide Solution';
        button.style.background = '#ef4444';
    } else {
        solution.classList.add('hidden');
        button.textContent = 'Show Solution';
        button.style.background = '#3b82f6';
    }
}

// Smooth scrolling for navigation links
document.addEventListener('DOMContentLoaded', function() {
    const navLinks = document.querySelectorAll('.nav-links a');

    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();

            // Remove active class from all links
            navLinks.forEach(l => l.classList.remove('active'));

            // Add active class to clicked link
            this.classList.add('active');

            // Get target section
            const targetId = this.getAttribute('href');
            const targetSection = document.querySelector(targetId);

            // Scroll to section
            if (targetSection) {
                targetSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Update active link on scroll
    const sections = document.querySelectorAll('.section');

    window.addEventListener('scroll', function() {
        let current = '';

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;

            if (pageYOffset >= (sectionTop - 100)) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + current) {
                link.classList.add('active');
            }
        });
    });

    // Add animation to cards on scroll
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe all cards and example boxes
    const animatedElements = document.querySelectorAll('.card, .example-box');
    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(el);
    });

    // Add copy button to code blocks
    const codeContainers = document.querySelectorAll('.code-container');

    codeContainers.forEach(container => {
        const copyButton = document.createElement('button');
        copyButton.textContent = 'Copy';
        copyButton.className = 'copy-btn';
        copyButton.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: #10b981;
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85rem;
            transition: all 0.3s ease;
        `;

        container.style.position = 'relative';
        container.appendChild(copyButton);

        copyButton.addEventListener('click', function() {
            const code = container.querySelector('code').textContent;
            navigator.clipboard.writeText(code).then(() => {
                copyButton.textContent = 'Copied!';
                copyButton.style.background = '#3b82f6';

                setTimeout(() => {
                    copyButton.textContent = 'Copy';
                    copyButton.style.background = '#10b981';
                }, 2000);
            });
        });

        copyButton.addEventListener('mouseenter', function() {
            this.style.background = '#059669';
        });

        copyButton.addEventListener('mouseleave', function() {
            if (this.textContent === 'Copy') {
                this.style.background = '#10b981';
            }
        });
    });

    // Add progress bar
    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
        position: fixed;
        top: 0;
        left: 280px;
        right: 0;
        height: 4px;
        background: linear-gradient(90deg, #2563eb, #3b82f6);
        transform-origin: left;
        transform: scaleX(0);
        z-index: 9999;
        transition: transform 0.1s ease;
    `;
    document.body.appendChild(progressBar);

    window.addEventListener('scroll', function() {
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight - windowHeight;
        const scrolled = window.scrollY;
        const progress = scrolled / documentHeight;

        progressBar.style.transform = `scaleX(${progress})`;
    });

    // Back to top button
    const backToTop = document.createElement('button');
    backToTop.innerHTML = '↑';
    backToTop.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 50px;
        height: 50px;
        background: #2563eb;
        color: white;
        border: none;
        border-radius: 50%;
        font-size: 1.5rem;
        cursor: pointer;
        display: none;
        z-index: 1000;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        transition: all 0.3s ease;
    `;
    document.body.appendChild(backToTop);

    window.addEventListener('scroll', function() {
        if (window.scrollY > 300) {
            backToTop.style.display = 'block';
        } else {
            backToTop.style.display = 'none';
        }
    });

    backToTop.addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    backToTop.addEventListener('mouseenter', function() {
        this.style.background = '#1e40af';
        this.style.transform = 'translateY(-5px)';
    });

    backToTop.addEventListener('mouseleave', function() {
        this.style.background = '#2563eb';
        this.style.transform = 'translateY(0)';
    });

    // Add search functionality
    const searchContainer = document.createElement('div');
    searchContainer.style.cssText = `
        padding: 1rem 2rem;
        background: rgba(59, 130, 246, 0.1);
        margin-bottom: 1rem;
    `;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search topics...';
    searchInput.style.cssText = `
        width: 100%;
        padding: 0.75rem;
        border: 2px solid #3b82f6;
        border-radius: 8px;
        font-size: 1rem;
        outline: none;
        transition: all 0.3s ease;
    `;

    searchContainer.appendChild(searchInput);

    const sidebar = document.querySelector('.sidebar');
    const navLinks2 = document.querySelector('.nav-links');
    sidebar.insertBefore(searchContainer, navLinks2);

    searchInput.addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase();
        const links = document.querySelectorAll('.nav-links a');

        links.forEach(link => {
            const text = link.textContent.toLowerCase();
            if (text.includes(searchTerm)) {
                link.parentElement.style.display = 'block';
            } else {
                link.parentElement.style.display = 'none';
            }
        });
    });

    searchInput.addEventListener('focus', function() {
        this.style.borderColor = '#2563eb';
        this.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1)';
    });

    searchInput.addEventListener('blur', function() {
        this.style.boxShadow = 'none';
    });

    // Print functionality
    const printButton = document.createElement('button');
    printButton.innerHTML = '🖨️ Print';
    printButton.style.cssText = `
        position: fixed;
        bottom: 90px;
        right: 30px;
        padding: 0.75rem 1.5rem;
        background: #10b981;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        cursor: pointer;
        z-index: 1000;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        transition: all 0.3s ease;
    `;
    document.body.appendChild(printButton);

    printButton.addEventListener('click', function() {
        window.print();
    });

    printButton.addEventListener('mouseenter', function() {
        this.style.background = '#059669';
        this.style.transform = 'translateY(-2px)';
    });

    printButton.addEventListener('mouseleave', function() {
        this.style.background = '#10b981';
        this.style.transform = 'translateY(0)';
    });

    // Add keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Alt + number keys to navigate to sections
        if (e.altKey && e.key >= '1' && e.key <= '6') {
            const index = parseInt(e.key) - 1;
            const links = document.querySelectorAll('.nav-links a');
            if (links[index]) {
                links[index].click();
            }
        }

        // Alt + S for search
        if (e.altKey && e.key === 's') {
            e.preventDefault();
            searchInput.focus();
        }

        // Alt + T for top
        if (e.altKey && e.key === 't') {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    // Show all solutions button for each section
    const sections2 = document.querySelectorAll('.section');
    sections2.forEach(section => {
        const toggleButtons = section.querySelectorAll('.toggle-btn');
        if (toggleButtons.length > 0) {
            const showAllBtn = document.createElement('button');
            showAllBtn.textContent = 'Show All Solutions';
            showAllBtn.style.cssText = `
                background: #10b981;
                color: white;
                border: none;
                padding: 0.75rem 1.5rem;
                border-radius: 8px;
                cursor: pointer;
                font-size: 1rem;
                font-weight: 600;
                margin-bottom: 1rem;
                transition: all 0.3s ease;
            `;

            section.querySelector('h2').after(showAllBtn);

            showAllBtn.addEventListener('click', function() {
                const allHidden = Array.from(section.querySelectorAll('.solution')).every(s =>
                    s.classList.contains('hidden')
                );

                toggleButtons.forEach(btn => {
                    const solutionId = btn.getAttribute('onclick').match(/'([^']+)'/)[1];
                    const solution = document.getElementById(solutionId);

                    if (allHidden) {
                        solution.classList.remove('hidden');
                        btn.textContent = 'Hide Solution';
                        btn.style.background = '#ef4444';
                    } else {
                        solution.classList.add('hidden');
                        btn.textContent = 'Show Solution';
                        btn.style.background = '#3b82f6';
                    }
                });

                this.textContent = allHidden ? 'Hide All Solutions' : 'Show All Solutions';
                this.style.background = allHidden ? '#ef4444' : '#10b981';
            });

            showAllBtn.addEventListener('mouseenter', function() {
                this.style.transform = 'translateY(-2px)';
                this.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
            });

            showAllBtn.addEventListener('mouseleave', function() {
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = 'none';
            });
        }
    });
});
