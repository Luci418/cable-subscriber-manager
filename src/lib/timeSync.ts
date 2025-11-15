// IST Time Sync utility using WorldTimeAPI
let cachedOffset: number | null = null;
let lastSyncTime: number = 0;
const SYNC_INTERVAL = 3600000; // Sync every hour

export const getISTTime = async (): Promise<Date> => {
  const now = Date.now();
  
  // Use cached offset if available and recent
  if (cachedOffset !== null && now - lastSyncTime < SYNC_INTERVAL) {
    return new Date(now + cachedOffset);
  }
  
  try {
    const response = await fetch('https://worldtimeapi.org/api/timezone/Asia/Kolkata', {
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    if (response.ok) {
      const data = await response.json();
      const serverTime = new Date(data.datetime).getTime();
      cachedOffset = serverTime - now;
      lastSyncTime = now;
      return new Date(serverTime);
    }
  } catch (error) {
    console.warn('Failed to sync time from server, using local time:', error);
  }
  
  // Fallback to local time if sync fails
  return new Date();
};

export const formatISTDate = async (date?: Date): Promise<string> => {
  const istDate = date || await getISTTime();
  return istDate.toISOString();
};

// Synchronous version for backward compatibility (uses cached offset)
export const formatISTDateSync = (date: Date = new Date()): string => {
  if (cachedOffset !== null) {
    return new Date(date.getTime() + cachedOffset).toISOString();
  }
  return date.toISOString();
};

// Initialize time sync on app load
export const initTimeSync = () => {
  getISTTime().catch(() => {
    // Silently fail, will use local time
  });
};
