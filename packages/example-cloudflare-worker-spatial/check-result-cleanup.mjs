import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const source=await readFile(new URL('../ducklings-workers-shared/src/index.ts',import.meta.url),'utf8');
const start=source.indexOf('  async run<T = Record<string, unknown>>('),end=source.indexOf('  async execute()',start);
const method=source.slice(start,end).split('\n  /**')[0];
const {code}=await transform(`class TestStatement {closed=false;stmtPtr=1;sql='fixture';${method}}`,{loader:'ts',target:'es2022'});
for(const fault of ['none','execute','status','convert']){
 const calls=[];const heap=new Uint8Array(128).fill(255);
 const mod={HEAPU8:heap,_malloc:()=>32,_free:p=>calls.push(['free',p]),UTF8ToString:()=>fault==='status'?'query failed':'col',ccall:(name)=>{
  if(name==='duckdb_execute_prepared'){assert.ok(heap.slice(32,96).every(x=>x===0));if(fault==='execute')throw Error('execution failed');return fault==='status'?1:0;}
  if(name==='duckdb_destroy_result'){calls.push(['destroy',32]);return;}
  if(name==='duckdb_column_count'||name==='duckdb_row_count'||name==='duckdb_column_name'||name==='duckdb_column_type'||name==='duckdb_result_error')return 1;
  return 0;
 }};
 const Statement=new Function('getModule','DuckDBError','canDecodeRawColumnData','readTextColumnDataFromResult',`${code};return TestStatement;`)(()=>mod,Error,()=>false,()=>{if(fault==='convert')throw Error('conversion failed');return ['value'];});
 const promise=new Statement().run();if(fault==='none')assert.deepEqual(await promise,[{col:'value'}]);else await assert.rejects(promise);
 assert.deepEqual(calls,[['destroy',32],['free',32]]);
}
console.log('Native results destroyed exactly once on success, execution failure, SQL failure, and conversion failure');
