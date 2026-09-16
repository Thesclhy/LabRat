import { describe, expect, it, vi } from "vitest";
import {
  listServerRegionExtractionTemplates, createServerRegionExtractionTemplate,
  getServerRegionExtractionTemplate, createServerRegionExtractionTemplateVersion,
  archiveServerRegionExtractionTemplate, matchServerRegionExtractionTemplate,
  applyServerRegionExtractionTemplate, confirmServerWorkbookReviewRegionsBatch,
  readServerSourceDocumentCellClasses, listServerLinkedDataKinds,
  createServerLinkedDataComparison,
} from "./serverApi.js";
import { apiV1Request, onWorkspaceAccessLost } from "./backendApiV1Client.ts";

const response = (value) => new Response(JSON.stringify(value), {headers:{"content-type":"application/json"}});

describe("Claude feature v1 adapters", () => {
  it("collects extraction template pages without losing source or version metadata", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({items:[{id:"first",sourceRegionId:"region",currentVersionId:"version"}],nextCursor:"page2"}))
      .mockResolvedValueOnce(response({items:[{id:"second",anchorRange:"C2:D11"}],nextCursor:null}));
    const result=await listServerRegionExtractionTemplates("project",{fetch});
    expect(result).toEqual({regionExtractionTemplates:[{id:"first",sourceRegionId:"region",currentVersionId:"version"},{id:"second",anchorRange:"C2:D11"}],nextCursor:null});
    expect(fetch.mock.calls[1][0]).toContain("cursor=page2");
  });

  it("routes all eleven operations through v1 and preserves formula, series and frozen response data", async () => {
    const payload={sourceRegionLink:{linkedExperimentId:"exp"},provenance:{brokenCells:["D3"]},series:[{seriesKey:"rate",xColumn:"C",yColumn:"D"}],frozenRegionRefs:[{revisionId:"accepted"}]};
    const fetch=vi.fn(async ()=>response(payload));
    const options={fetch};
    const operations=[
      ()=>readServerSourceDocumentCellClasses("source",{sheetName:"Data",range:"C2:D11"},options),
      ()=>createServerRegionExtractionTemplate("project",{name:"Rate",regionId:"region"},options),
      ()=>getServerRegionExtractionTemplate("template",options),
      ()=>createServerRegionExtractionTemplateVersion("template",{regionId:"region"},options),
      ()=>archiveServerRegionExtractionTemplate("template",options),
      ()=>matchServerRegionExtractionTemplate("version",{sourceDocumentIds:["source"]},options),
      ()=>applyServerRegionExtractionTemplate("version",{sourceDocumentIds:["source"],idempotencyKey:"apply-1"},options),
      ()=>confirmServerWorkbookReviewRegionsBatch("project",{items:[{regionId:"region",revisionId:"revision",expectedRegionVersion:3,linkedExperimentId:"exp"}]},options),
      ()=>listServerLinkedDataKinds("project",options),
      ()=>createServerLinkedDataComparison("project",{dataKind:"Rate",experimentIds:["exp"],dryRun:true},options),
    ];
    for(const operation of operations) expect(await operation()).toEqual(payload);
    expect(fetch.mock.calls.every(([url])=>url.startsWith("/api/v1/"))).toBe(true);
    expect(fetch.mock.calls.map(([,init])=>init.method)).toEqual(["GET","POST","GET","POST","POST","POST","POST","POST","GET","POST"]);
    expect(new Headers(fetch.mock.calls[6][1].headers).get("Idempotency-Key")).toBe("apply-1");
    expect(JSON.parse(fetch.mock.calls[7][1].body)).toEqual({items:[{regionId:"region",revisionId:"revision",expectedRegionVersion:3,linkedExperimentId:"exp"}]});
    expect(JSON.parse(fetch.mock.calls[9][1].body).dryRun).toBe(true);
  });

  it("reports permission loss on template resources so the workspace can clear stale state", async () => {
    const lost=vi.fn();
    const unsubscribe=onWorkspaceAccessLost(lost);
    try {
      await expect(apiV1Request("post","/api/v1/region-extraction-template-versions/{versionId}/apply",{
        pathParams:{versionId:"version"},body:{sourceDocumentIds:["source"]},
        fetch:async()=>new Response(JSON.stringify({error:{code:"forbidden",message:"Revoked"}}),{status:403}),
      })).rejects.toMatchObject({status:403});
      expect(lost).toHaveBeenCalledWith(403);
    } finally {unsubscribe();}
  });
});
