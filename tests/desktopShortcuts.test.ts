import {describe,expect,it} from 'vitest';
import {desktopShortcut} from '../src/shared/desktopShortcuts';
const key=(key:string,extra={})=>({key,ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,repeat:false,...extra});
describe('Desktop shortcuts',()=>{
 it('routes Ctrl+O and Ctrl+R independently of the focused editable element',()=>{
  expect(desktopShortcut(key('o'))).toBe('open-folder');
  expect(desktopShortcut(key('r'))).toBe('run-scan');
  expect(desktopShortcut(key('R'))).toBe('run-scan');
 });
 it('routes Command shortcuts on macOS and preserves other modifiers',()=>{
  const command={ctrlKey:false,metaKey:true};
  expect(desktopShortcut(key('o',command),'darwin')).toBe('open-folder');
  expect(desktopShortcut(key('r',command),'darwin')).toBe('run-scan');
  expect(desktopShortcut(key('r'),'darwin')).toBeNull();
  for(const extra of [{repeat:true},{ctrlKey:true},{altKey:true},{shiftKey:true}]) expect(desktopShortcut(key('r',{...command,...extra}),'darwin')).toBeNull();
 });
 it('does not repeat submissions or consume other modified shortcuts',()=>{
  for(const extra of [{repeat:true},{ctrlKey:false},{altKey:true},{shiftKey:true},{metaKey:true}])expect(desktopShortcut(key('r',extra))).toBeNull();
  expect(desktopShortcut(key('s'))).toBeNull();
 });
});
