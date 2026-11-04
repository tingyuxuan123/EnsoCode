import { app } from 'electron';
import { type DesignResourcePaths, designResourcePaths } from './paths';

/** Resource-only entry point: worker setup must not pull in Main window modules. */
export function getDesignPaths(): DesignResourcePaths {
  return designResourcePaths({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    userDataPath: app.getPath('userData'),
  });
}

/** Shared by local session startup and the pre-spawn skill menu. */
export function bundledDesignSkillPaths(state: Record<string, unknown> | undefined): string[] {
  return state?.designEnabled === false ? [] : [getDesignPaths().skillsDir];
}
