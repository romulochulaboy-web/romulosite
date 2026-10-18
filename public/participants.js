(() => {
  "use strict";
  const NativeWebSocket = window.WebSocket;
  const nameInput = document.getElementById("participantName");
  const list = document.getElementById("participantList");
  const count = document.getElementById("participantCount");
  if (!NativeWebSocket || !nameInput || !list || !count) return;

  try { nameInput.value = localStorage.getItem("shareroom-display-name") || ""; } catch {}
  nameInput.addEventListener("input", () => {
    try { localStorage.setItem("shareroom-display-name", nameInput.value.slice(0, 32)); } catch {}
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
          data.name = (nameInput.value || "").replace(/[<>\r\n\t]/g, "").trim().slice(0, 32) || "Visitante";
          outgoing = JSON.stringify(data);
        }
      } catch {}
      return super.send(outgoing);
    }
  }
  Object.setPrototypeOf(RoomWebSocket, NativeWebSocket);
  window.WebSocket = RoomWebSocket;
})();