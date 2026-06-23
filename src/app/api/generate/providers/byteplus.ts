/**
 * BytePlus (Seedream image / Seedance video) provider.
 *
 * Engine-backed (local-dev cutover): the input/output mapping and capability
 * routing run through the fork's execution-adapter against the zerogen engine
 * over HTTP — see `./engine`. Provider keys live server-side in the engine.
 */
import { engineBinding } from "./engine";

export const generateWithByteplus = engineBinding("byteplus");
