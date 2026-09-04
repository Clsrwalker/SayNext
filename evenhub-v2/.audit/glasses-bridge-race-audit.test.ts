import {describe,test,expect,vi} from 'vitest';
import {StartUpPageCreateResult} from '@evenrealities/even_hub_sdk';
import {connectResolvedGlassBridge} from '../src/glasses-bridge';

describe('bridge startup race audit',()=>{
  test('AUDIT: obsolete startup completing last removes the latest event subscription',async()=>{
    let finishOld!: (result:StartUpPageCreateResult)=>void;
    const oldStartup=new Promise<StartUpPageCreateResult>(resolve=>{finishOld=resolve;});
    const listeners=new Set<(event:any)=>void>();
    const bridge={
      createStartUpPageContainer:vi.fn().mockReturnValueOnce(oldStartup).mockResolvedValueOnce(StartUpPageCreateResult.success),
      rebuildPageContainer:vi.fn(async()=>true),
      onEvenHubEvent:vi.fn((fn:(event:any)=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);}),
      textContainerUpgrade:vi.fn(async()=>true),
      audioControl:vi.fn(async()=>true),
    };
    const latestEvent=vi.fn();
    const page={view:'root_idle',containers:[]} as any;
    const oldConnect=connectResolvedGlassBridge(bridge as any,{initialPage:page,onEvent:vi.fn()});
    const latest=await connectResolvedGlassBridge(bridge as any,{initialPage:page,onEvent:latestEvent});
    expect(listeners.size).toBe(1);
    finishOld(StartUpPageCreateResult.invalid);
    const obsolete=await oldConnect;
    // App's connection generation guard disposes this obsolete handle.
    obsolete.dispose();
    expect(listeners.size).toBe(0);
    latest.dispose();
  });
});
