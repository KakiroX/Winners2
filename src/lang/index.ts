import { Interpreter, type HostIO } from './interp';
import { registerCore } from './builtins/core';
import { registerMath } from './builtins/math';
import { registerLinalg } from './builtins/linalg';
import { registerStrings } from './builtins/strings';
import { registerCells } from './builtins/cells';
import { registerNumerics } from './builtins/numerics';
import { registerStatsFns } from './builtins/statsfns';
import { registerGraphics, type GraphicsState } from './builtins/graphics';
import { registerApp } from './builtins/app';
import { registerFileIO } from './builtins/fileio';

export function createInterpreter(io: HostIO): Interpreter {
  const I = new Interpreter(io);
  registerCore(I);
  registerMath(I);
  registerLinalg(I);
  registerStrings(I);
  registerCells(I);
  registerNumerics(I);
  registerStatsFns(I);
  registerGraphics(I);
  registerApp(I);
  registerFileIO(I);
  return I;
}

export function graphicsOf(I: Interpreter): GraphicsState {
  return I.graphics as GraphicsState;
}

export { Interpreter };
export type { HostIO };
