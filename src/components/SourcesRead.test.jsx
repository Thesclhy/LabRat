import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { SourcesRead } from './SourcesRead.jsx';

const passage=(id,page,versionId='v1')=>({id,kind:'document_passage',label:'Same name.pdf',
  version:{documentId:'doc',versionId,versionNumber:versionId==='v1'?1:2},locator:{kind:'pdf',page}});
test('groups windows by immutable source identity and opens the precise read evidence',()=>{
  const onOpen=vi.fn();
  const artifact={answer:{provenanceVersion:2,claims:[]},evidence:[passage('a',1),passage('b',2),passage('c',1,'v2'),
    {...passage('d',3),version:{documentId:'other-doc',versionId:'other-v1',versionNumber:1}}],trace:[]};
  render(<SourcesRead artifact={artifact} onOpen={onOpen}/>);
  const summary=screen.getByText('Sources read · 3');
  expect(summary.closest('details').open).toBe(false);
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole('button',{name:'Page 2'}));
  expect(onOpen).toHaveBeenCalledWith('b');
  expect(screen.getAllByText('Same name.pdf')).toHaveLength(3);
});
test('discovery and failed reads never appear as successfully read source windows',()=>{
  render(<SourcesRead artifact={{answer:{provenanceVersion:2},evidence:[],trace:[
    {tool:'search_project_documents',phase:'discovery',status:'ok',input:{query:'RQ-001'},returnedCount:2,evidenceIds:[]},
    {tool:'read_document_passage',phase:'read',status:'evidence_not_found',input:{passageId:'x'}}]}} onOpen={()=>{}}/>);
  fireEvent.click(screen.getByText('Sources read · 0'));
  expect(screen.getByText('No source passages or data windows were read.')).toBeTruthy();
  fireEvent.click(screen.getByText('Search and read activity'));
  expect(screen.getByText('2 matches · search only')).toBeTruthy();
  expect(screen.getByText('Could not complete: evidence_not_found')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
test('historical cited-only artifacts are not relabeled as complete reading records',()=>{
  render(<SourcesRead artifact={{answer:{claims:[]},evidence:[passage('old',1)],trace:[{tool:'read_document_passage',status:'ok'}]}} onOpen={()=>{}}/>);
  fireEvent.click(screen.getByText('Saved sources · 1'));
  expect(screen.getByText(/a complete reading record is not available/)).toBeTruthy();
});
