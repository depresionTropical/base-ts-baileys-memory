// src/services/redisService.ts

import { createClient, RedisClientType } from 'redis';
import * as dotenv from 'dotenv';

dotenv.config(); // Cargar variables de entorno aquí también si este módulo se importa primero

let redisClientInstance: RedisClientType | null = null; // Usar un nombre diferente para la instancia

export async function initializeRedisClient(): Promise<void> {
    if (redisClientInstance && redisClientInstance.isReady) {
        console.log("Redis client already initialized and connected.");
        return;
    }

    try {
        redisClientInstance = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379'
        }) as RedisClientType;

        redisClientInstance.on('error', (err) => {
            console.error('Redis Client Error:', err);
            // Considera cómo manejar errores en producción: reintentos, logging avanzado, etc.
            // No salir del proceso aquí si solo es un error de conexión que se puede recuperar.
        });

        await redisClientInstance.connect();
        console.log("Conectado a Redis.");
    } catch (err) {
        console.error("Fallo al conectar a Redis:", err);
        // Podrías lanzar el error o manejarlo de otra forma si la conexión inicial es crítica.
        throw new Error("Failed to connect to Redis: " + (err as Error).message);
    }
}

export function getRedisClient(): RedisClientType {
    if (!redisClientInstance || !redisClientInstance.isReady) {
        // En producción, esto podría ser un error grave si la aplicación no está lista.
        // Asegúrate de llamar initializeRedisClient() antes de usar getRedisClient().
        throw new Error("Redis client not initialized or not connected. Call initializeRedisClient() first.");
    }
    return redisClientInstance;
}

// Opcional: Función para cerrar la conexión de Redis si tu aplicación lo requiere (ej. al apagar)
export async function closeRedisClient(): Promise<void> {
    if (redisClientInstance && redisClientInstance.isReady) {
        await redisClientInstance.disconnect();
        console.log("Redis client disconnected.");
        redisClientInstance = null;
    }
}