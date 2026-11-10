const requests=[
 ['trending','https://github.com/trending?since=daily'],
 ['search','https://api.github.com/search/repositories?q=topic%3Allm+stars%3A%3E%3D1000+fork%3Afalse+archived%3Afalse&per_page=1&sort=stars&order=desc']
];
for(const [name,url] of requests){try{const response=await fetch(url,{headers:{Accept:name==='search'?'application/vnd.github+json':'text/html'},signal:AbortSignal.timeout(20000)});const body=await response.text();console.log(JSON.stringify({name,status:response.status,rateRemaining:response.headers.get('x-ratelimit-remaining'),hasTrendingRows:name==='trending'?body.includes('Box-row'):undefined,repo:name==='search'&&response.ok?JSON.parse(body).items?.[0]?.full_name:undefined,error:!response.ok?body.slice(0,240):undefined}));if(!response.ok)process.exitCode=1;}catch(error){console.error(name,error.message);process.exitCode=1;}}
