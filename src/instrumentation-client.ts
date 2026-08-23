try {
  for (const element of document.querySelectorAll("[data-sharkid], [data-sharklabel]")) {
    element.removeAttribute("data-sharkid");
    element.removeAttribute("data-sharklabel");
  }
} catch {}
