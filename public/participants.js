(() => {
  "use strict";
  const NativeWebSocket = window.WebSocket;
  const nameInput = document.getElementById("participantName");
  const list = document.getElementById("participantList");
  const count = document.getElementById("participantCount");
  if (!NativeWebSocket || !nameInput || !list || !count) return;

  const NAME_KEY = "shareroom-display-name";
  function makeAutomaticName() {
    const bytes = new Uint8Array(2);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else {
      bytes[0] = Math.floor(Math.random() * 256);
      bytes[1] = Math.floor(Math.random() * 256);
    }
    return "Visitante-" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  // Each browser gets a persistent automatic display name; no signup or typing required.
  let savedName = "";
  try { savedName = (localStorage.getItem(NAME_KEY) || "").trim(); } catch {}
  if (!savedName) {
    savedName = makeAutomaticName();
    try { localStorage.setItem(NAME_KEY, savedName); } catch {}
  }
  nameInput.value = savedName;
  nameInput.placeholder = "Nome automático da sua sessão";
  nameInput.addEventListener("input", () => {
    const cleaned = nameInput.value.replace(/[<>\\r\\n\\t]/g, "").trim().slice(0, 32);
    try {
      if (cleaned) localStorage.setItem(NAME_KEY, cleaned);
      else localStorage.setItem(NAME_KEY, makeAutomaticName());
    } catch {}
  });
  nameInput.addEventListener("blur", () => {
    if (!nameInput.value.trim()) {
      nameInput.value = makeAutomaticName();
      try { localStorage.setItem(NAME_KEY, nameInput.value); } catch {}
    }
  });

  let myId = null;
  function renderParticipants(participants) {
    const people = Array.isArray(participants) ? participants : [];
    count.textContent = people.length + (people.length === 1 ? " conectada" : " conectadas");
    list.replaceChildren();
    if (!people.length) {
      const empty = document.createElement("li");
      empty.className = "participants-empty";
      empty.textContent = "Entre na sala para ver quem está conectado.";
      list.append(empty);
      return;
    }
    for (const person of people) {
      const item = document.createElement("li");
      item.className = "participant-item";
      const avatar = document.createElement("span");
      avatar.className = "participant-avatar";
      avatar.textContent = (person.name || "P").trim().charAt(0).toLocaleUpperCase("pt-BR") || "P";
      const details = document.createElement("span");
      details.className = "participant-details";
      const name = document.createElement("strong");
      name.className = "participant-name";
      name.textContent = (person.name || "Participante") + (person.id === myId ? " (você)" : "");
      const status = document.createElement("small");
      status.textContent = person.role === "host" ? "Compartilhando tela" : "Assistindo";
      details.append(name, status);
      const dot = document.createElement("span");
      dot.className = "participant-online";
      dot.setAttribute("aria-label", "Conectado");
      item.append(avatar, details, dot);
      list.append(item);
    }
  }

  class RoomWebSocket extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", event => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === "joined") myId = data.id;
        if (data.type === "participant-list") renderParticipants(data.participants);
        if (data.type === "close") renderParticipants([]);
      });
      this.addEventListener("close", () => {
        myId = null;
        renderParticipants([]);
      });
    }
    send(value) {
      let outgoing = value;
      try {
        const data = JSON.parse(value);
        if (data.type === "join") {
          data.name = (nameInput.value || savedName || makeAutomaticName()).replace(/[<>\\r\\n\\t]/g, "").trim().slice(0, 32) || savedName;
          outgoing = JSON.stringify(data);
        }
      } catch {}
      return super.send(outgoing);
    }
  }
  Object.setPrototypeOf(RoomWebSocket, NativeWebSocket);
  window.WebSocket = RoomWebSocket;
})();