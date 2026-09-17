import test from 'node:test';
import assert from 'node:assert/strict';
import {youtubeVideoId} from '../core.js';
const id='7lCDEYXw3mM';
test('YouTube video links normalize across sharing, mobile, shorts, live and embed URLs',()=>{
 for(const url of [`https://youtube.com/watch?v=${id}&si=tracking`,`https://www.youtube.com/watch?list=test&v=${id}`,`https://youtu.be/${id}?t=30`,`https://m.youtube.com/watch?v=${id}`,`https://www.youtube.com/shorts/${id}`,`https://youtube.com/live/${id}`,`https://www.youtube-nocookie.com/embed/${id}`])assert.equal(youtubeVideoId(url),id);
});
test('YouTube parsing rejects lookalike domains, credentials, executable URLs and non-video links',()=>{
 for(const url of ['javascript:alert(1)',`https://youtube.com.evil.example/watch?v=${id}`,`https://youtube.com@evil.example/watch?v=${id}`,`https://user@youtube.com/watch?v=${id}`,`https://youtube.com:123/watch?v=${id}`,'https://www.youtube.com/playlist?list=abcd','https://youtube.com/@channel','https://youtu.be/bad',`https://youtu.be/${id}/extra`,'<iframe src="test">'])assert.throws(()=>youtubeVideoId(url));
});
