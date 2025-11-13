import fs from 'fs';
import crypto from 'crypto';

const readJSONFile = (filePath) => {
  const rawData = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(rawData);
};

const writeJSONFile = (filePath, data) => {
  const jsonString = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, jsonString, 'utf-8');
};

const ensureFileExists = (filePath, initialData) => {
  if (!fs.existsSync(filePath)) {
    writeJSONFile(filePath, initialData);
  }
};

const isACommit = (lastEntry) => {
  return lastEntry.hasOwnProperty('commitId');
};

// Generador de UUID v4; usa crypto.randomUUID si está disponible, si no, genera a partir de randomBytes
const generateUUID = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.randomBytes(16);
  // Per RFC 4122 v4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.substr(0,8)}-${hex.substr(8,4)}-${hex.substr(12,4)}-${hex.substr(16,4)}-${hex.substr(20,12)}`;
};

const getLastTestId = (filePath) => {
  ensureFileExists(filePath, []);
  const historyExecutionData = readJSONFile(filePath);
  const lastEntry = historyExecutionData[historyExecutionData.length - 1];
  
  if (lastEntry) {
    if (isACommit(lastEntry)) {
      return generateUUID(); // Si el último es un commit, el próximo testId se incrementa
    } else { //Ejecución de pruebas
      return lastEntry.hasOwnProperty('testId') ? lastEntry.testId : generateUUID(); // Incrementa el testId
    }
  } else {
    return generateUUID(); // Si el archivo está vacío, comienza con testId 0
  }
};

export {getLastTestId };