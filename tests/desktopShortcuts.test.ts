import {describe,expect,it} from 'vitest';
import {desktopShortcut} from '../src/shared/desktopShortcuts';
const key=(key:string,extra={})=>({key,ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,repeat:false,...extra});
describe('Windows desktop shortcuts',()=>{
 it('routes Ctrl+O and Ctrl+R independently of the focused editable element',()=>{
  expect(desktopShortcut(key('o'))).toBe('open-folder');
  expect(desktopShortcut(key('r'))).toBe('run-scan');
  expect(desktopShortcut(key('R'))).toBe('run-scan');
 });
 it('does not repeat submissions or consume other modified shortcuts',()=>{
  for(const extra of [{repeat:true},{ctrlKey:false},{altKey:true},{shiftKey:true},{metaKey:true}])expect(desktopShortcut(key('r',extra))).toBeNull();
  expect(desktopShortcut(key('s'))).toBeNull();
 });
});
