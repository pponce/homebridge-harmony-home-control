import test from 'node:test';
import assert from 'node:assert/strict';
import { keycodeData } from '../configurator-web/ir-code.js';

test('Toshiba command data displays the exact hexadecimal and binary value',()=>{
  assert.deepEqual(keycodeData('G:Toshiba 32 Bit:(0xA156F609)(Repeat)():3'),[
    {phase:'Start',segment:'0',hex:'A1 56 F6 09',binary:'10100001 01010110 11110110 00001001'}
  ]);
});

test('keycode data preserves leading zeros and values wider than JavaScript integers',()=>{
  assert.deepEqual(keycodeData('G:Example:(0x00fEDcBA9876543210)()():3'),[
    {phase:'Start',segment:'0',hex:'00 FE DC BA 98 76 54 32 10',binary:'00000000 11111110 11011100 10111010 10011000 01110110 01010100 00110010 00010000'}
  ]);
  assert.equal(keycodeData('G:Example:()(0x0000)():3')[0].binary,'00000000 00000000');
});

test('keycode values retain their phase, segment and order without converting named segments',()=>{
  assert.deepEqual(keycodeData('G:Example:(Start_0x00_0x01)(1x80_Repeat)(Ax0F):3'),[
    {phase:'Start',segment:'0',hex:'00',binary:'00000000'},
    {phase:'Start',segment:'0',hex:'01',binary:'00000001'},
    {phase:'Repeat',segment:'1',hex:'80',binary:'10000000'},
    {phase:'Finish',segment:'A',hex:'0F',binary:'00001111'}
  ]);
  assert.deepEqual(keycodeData('G:Example:(Start)(Repeat)():3'),[]);
});

test('hexadecimal views preserve the written width instead of guessing protocol padding',()=>{
  assert.deepEqual(keycodeData(' G:Sony 13 Bit:()(0x8d1)():3\n'),[
    {phase:'Repeat',segment:'0',hex:'8 D1',binary:'1000 11010001'}
  ]);
  assert.equal(keycodeData('G:Example:(0x0001)()():3')[0].hex,'00 01');
});

test('unknown and malformed keycodes cannot produce a partial or guessed conversion',()=>{
  for(const value of [null,undefined,{},'', 'opaque-keycode','G:Example:(0xA1)(Repeat):3','G:Example:(0xA1)()(0x00)(0x01):3','G:Example:(0x0xA1)()():3','G:Example:(0xA1_0xGG)()():3','G:Example:(0x)()():3','G:Example:(0xA1_)()():3','G:Example:(0xA1)()():3 trailing']) {
    assert.equal(keycodeData(value),null);
  }
});
