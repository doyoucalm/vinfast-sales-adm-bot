import { findActiveKaryawanByWa, KaryawanRow, getNamaPanggilan } from "../services/karyawan.js";
import { InboundMessage } from "../types/evolution.js";
import { logger } from "../services/logger.js";

export interface AuthContext {
  msg: InboundMessage;
  karyawan: KaryawanRow | null;
  isAuthorized: boolean;
  namaPanggilan: string | null;
}

export async function authenticate(msg: InboundMessage): Promise<AuthContext> {
  const kar = await findActiveKaryawanByWa(msg.fromNumber);

  if (kar) {
    logger.debug({ no_wa: msg.fromNumber, nama: kar.nama, role: kar.role }, "Karyawan authenticated");
  } else {
    logger.info({ no_wa: msg.fromNumber, pushName: msg.pushName }, "Non-karyawan message");
  }

  return {
    msg,
    karyawan: kar,
    isAuthorized: kar !== null,
    namaPanggilan: kar ? getNamaPanggilan(kar) : null,
  };
}
