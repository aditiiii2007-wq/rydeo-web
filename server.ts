import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Real-time matching storage
  const activeRequests = new Map(); // userId -> requestData
  const activeOffers = new Map();   // userId -> offerData
  const activeDrivers = new Map();  // driverId -> driverData

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("join_pool", (userData) => {
      console.log(`${userData.role} joining pool:`, userData.uid);
      if (userData.role === 'passenger') {
        activeRequests.set(userData.uid, { socketId: socket.id, ...userData });
      } else if (userData.role === 'offerer') {
        activeOffers.set(userData.uid, { socketId: socket.id, ...userData });
      } else if (userData.role === 'driver') {
        activeDrivers.set(userData.uid, { socketId: socket.id, ...userData });
      }
    });

    socket.on("find_match", (requestData) => {
      console.log("Finding match for:", requestData.uid, "Type:", requestData.type);
      if (requestData.type === 'offer') {
        activeOffers.set(requestData.uid, { socketId: socket.id, ...requestData });
        matchOffer(requestData.uid, io);
      } else {
        activeRequests.set(requestData.uid, { socketId: socket.id, ...requestData });
        matchRequest(requestData.uid, io);
      }
    });

    socket.on("sos_trigger", (data) => {
      console.log("🆘 SOS TRIGGERED:", data.uid, "Location:", data.location);
      // In a real app, this would broadcast to emergency services and safety teams
      io.emit("sos_broadcast", {
        ...data,
        timestamp: Date.now()
      });
    });

    socket.on("disconnect", () => {
      // Cleanup
      activeRequests.forEach((val, key) => {
        if (val.socketId === socket.id) activeRequests.delete(key);
      });
      activeOffers.forEach((val, key) => {
        if (val.socketId === socket.id) activeOffers.delete(key);
      });
      activeDrivers.forEach((val, key) => {
        if (val.socketId === socket.id) activeDrivers.delete(key);
      });
      console.log("User disconnected");
    });
  });

  function matchOffer(userId: string, io: SocketIOServer) {
    const offer = activeOffers.get(userId);
    if (!offer) return;

    // Find a passenger matching this offer's route
    for (const [requestId, request] of activeRequests.entries()) {
      if (request.pickup === offer.pickup && request.destination === offer.destination) {
        console.log(`Matched Offer ${userId} with Request ${requestId}`);
        
        const matchId = `match_${Date.now()}`;
        io.to(offer.socketId).emit("match_found", {
          matchId,
          partner: { uid: request.uid, displayName: request.displayName },
          type: 'passenger_request',
          details: request
        });

        io.to(request.socketId).emit("match_found", {
          matchId,
          partner: { uid: offer.uid, displayName: offer.displayName },
          type: 'commuter_offer',
          details: offer
        });

        activeOffers.delete(userId);
        activeRequests.delete(requestId);
        return;
      }
    }
  }

  function matchRequest(userId: string, io: SocketIOServer) {
    const request = activeRequests.get(userId);
    if (!request) return;

    // 1. Try to match with an available Offer first (P2P Carpooling)
    for (const [offerId, offer] of activeOffers.entries()) {
      if (offer.pickup === request.pickup && offer.destination === request.destination) {
        matchOffer(offerId, io); // Reuse logic
        return;
      }
    }

    // 2. Try to match with another passenger (Shared Ride)
    let matchedUserId: string | null = null;
    
    for (const [otherUserId, otherRequest] of activeRequests.entries()) {
      if (otherUserId !== userId && otherRequest.destination === request.destination) {
        matchedUserId = otherUserId;
        break;
      }
    }

    if (matchedUserId) {
      const otherRequest = activeRequests.get(matchedUserId);
      console.log(`Matched ${userId} with ${matchedUserId}`);
      
      io.to(request.socketId).emit("match_found", {
        matchId: `match_${Date.now()}`,
        partner: {
          uid: otherRequest.uid,
          displayName: otherRequest.displayName
        },
        type: 'passenger'
      });

      io.to(otherRequest.socketId).emit("match_found", {
        matchId: `match_${Date.now()}`,
        partner: {
          uid: request.uid,
          displayName: request.displayName
        },
        type: 'passenger'
      });

      // Remove from pool once matched
      activeRequests.delete(userId);
      activeRequests.delete(matchedUserId);
    } else {
      // If no passenger match, look for a driver (simulate)
      // In a real app, drivers would be around
      setTimeout(() => {
        if (activeRequests.has(userId)) {
           // Simulate finding a "system matched" driver if no peer match after 5s
           io.to(request.socketId).emit("system_matched", {
             driverName: "Suresh P.",
             vehicle: "Shared Auto • MH 12 XY 4455",
             eta: "4 mins"
           });
        }
      }, 5000);
    }
  }

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
