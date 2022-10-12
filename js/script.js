const menu = document.querySelector(".hamburgur");
const hide = document.querySelector(".hide");

menu.addEventListener("click", () => {
  hide.classList.toggle("show");
});

window.onbeforeunload = () => {
  for (const form of document.getElementsByTagName("form")) {
    form.reset();
  }
};

const header = document.querySelector("header");
let lastScrollY = window.scrollY;

window.addEventListener("scroll", () => {
  if (lastScrollY < window.scrollY) {
    header.classList.add("nav--hidden");
    hide.classList.remove("show");
  } else {
    header.classList.remove("nav--hidden");
  }

  lastScrollY = window.scrollY;
});
