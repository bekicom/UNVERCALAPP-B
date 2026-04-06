import { Server } from "socket.io";

let io = null;
const displayStates = new Map();

function emptyDisplayState(cashierUsername = "") {
  return {
    cashierUsername,
    shiftOpen: false,
    paymentType: "",
    totalAmount: 0,
    totalItems: 0,
    cartItems: [],
    updatedAt: new Date().toISOString()
  };
}

function roomName(cashierUsername) {
  return `display:${String(cashierUsername || "").trim().toLowerCase()}`;
}

export function initDisplayHub(server) {
  io = new Server(server, {
    cors: {
      origin: "*"
    }
  });

  io.on("connection", (socket) => {
    socket.on("cart:update", (payload) => {
      const cashierUsername = String(payload?.cashierUsername || "").trim();
      if (!cashierUsername) return;
      updateCustomerDisplayState(cashierUsername, payload);
    });

    socket.on("display:join", (payload) => {
      const cashierUsername = String(payload?.cashierUsername || "").trim();
      if (!cashierUsername) {
        socket.emit("display:state", emptyDisplayState(""));
        return;
      }
      socket.join(roomName(cashierUsername));
      socket.emit(
        "display:state",
        displayStates.get(roomName(cashierUsername)) ||
          emptyDisplayState(cashierUsername)
      );
    });

    socket.on("display:leave", (payload) => {
      const cashierUsername = String(payload?.cashierUsername || "").trim();
      if (!cashierUsername) return;
      socket.leave(roomName(cashierUsername));
    });
  });

  return io;
}

export function updateCustomerDisplayState(cashierUsername, payload) {
  const username = String(cashierUsername || "").trim();
  if (!username) return;

  const nextState = {
    ...emptyDisplayState(username),
    ...payload,
    cashierUsername: username,
    updatedAt: new Date().toISOString()
  };
  const room = roomName(username);
  displayStates.set(room, nextState);
  io?.to(room).emit("display:state", nextState);
}

export function clearCustomerDisplayState(cashierUsername, payload = {}) {
  const username = String(cashierUsername || "").trim();
  if (!username) return;
  updateCustomerDisplayState(username, {
    ...payload,
    shiftOpen: false,
    paymentType: "",
    totalAmount: 0,
    totalItems: 0,
    cartItems: []
  });
}

export function getCustomerDisplayState(cashierUsername) {
  const username = String(cashierUsername || "").trim();
  if (!username) return emptyDisplayState("");
  return displayStates.get(roomName(username)) || emptyDisplayState(username);
}
