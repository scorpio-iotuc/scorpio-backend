import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import type { Express } from 'express';

export interface PacketCreatedEventPayload {
  stationUuid: string;
  stationName: string;
  satelliteNoradId: number;
  satelliteDisplayName: string;
  rssi: number;
  snr: number;
  crc: boolean;
  createdAt: string;
}

let io: SocketIOServer | null = null;

export const initializeSocket = (app: Express): { server: ReturnType<typeof createServer>; io: SocketIOServer } => {
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const server = createServer(app);

  io = new SocketIOServer(server, {
    path: process.env.SOCKET_PATH ?? '/api/socket.io',
    cors: {
      origin: frontendUrl,
      credentials: true,
    },
  });

  return { server, io };
};

export const getIO = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.IO has not been initialized');
  }

  return io;
};

export const emitPacketCreated = (payload: PacketCreatedEventPayload): void => {
  if (!io) {
    return;
  }

  io.emit('packet:created', payload);
};
