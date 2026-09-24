// Reveal sections on scroll (no dependencies).
const sections = document.querySelectorAll("main > section");
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("reveal", "visible");
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.12 },
);
for (const section of sections) observer.observe(section);