(() => {
  "use strict";
  const grid = document.getElementById("streamGrid");
  const expandButton = document.getElementById("fullscreenBtn");
  if (!grid || !expandButton) return;

  let expandedTile = null;
  let closeButton = null;

  function closeExpanded() {
    if (!expandedTile) return;
    expandedTile.classList.remove("mobile-expanded");
    expandedTile = null;
    document.body.classList.remove("mobile-view-expanded");
    if (closeButton) closeButton.remove();
    closeButton = null;
    expandButton.setAttribute("aria-label", "Ampliar tela");
    expandButton.title = "Ampliar tela em destaque";
  }

  function expandSelected() {
    const tile = grid.querySelector(".stream-tile.is-primary") || grid.querySelector(".stream-tile");
    if (!tile) return;
    if (expandedTile === tile) { closeExpanded(); return; }
    closeExpanded();
    expandedTile = tile;
    tile.classList.add("mobile-expanded");
    document.body.classList.add("mobile-view-expanded");

    closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "mobile-expand-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Voltar para a sala");
    closeButton.addEventListener("click", closeExpanded);
    document.body.append(closeButton);
    expandButton.setAttribute("aria-label", "Recolher tela");
    expandButton.title = "Voltar para a sala";
  }

  // Captura o clique antes do handler legado para manter o comportamento
  // consistente no Safari iOS, inclusive quando requestFullscreen não existe.
  expandButton.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    expandSelected();
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && expandedTile) closeExpanded();
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && expandedTile) closeExpanded();
  });

  // Atualiza somente o parametro da sala na URL atual. Nao cria outra rota,
  // subdominio ou identificador de sala ao copiar/entrar pelo mesmo link.
  const roomInput = document.getElementById("roomInput");
  if (roomInput) {
    roomInput.addEventListener("input", () => {
      const room = String(roomInput.value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 48) || "rrzin";
      const url = new URL(window.location.href);
      url.searchParams.set("sala", room);
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    });
  }

  const observer = new MutationObserver(() => {
    if (expandedTile && !expandedTile.isConnected) closeExpanded();
  });
  observer.observe(grid, { childList: true, subtree: true });
})();
