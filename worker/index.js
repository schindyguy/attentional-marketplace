import { handleHandles }        from './routes/handles.js';
import { handlePublishers }     from './routes/publishers.js';
import { handleFeatured }       from './routes/featured.js';
import { handleRemoved }        from './routes/removed.js';
import { handleRecommend }      from './routes/recommend.js';
import { handleDiscover }       from './routes/discover.js';
import { handleAdminDiscover }  from './routes/admin_discover.js';
import { handleStats }          from './routes/stats.js';
import { handleAvatar }         from './routes/avatar.js';
import { handleUpload }         from './routes/upload.js';
import { handleOptions, json }  from './lib/cors.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();

    const url  = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/handles'))          return handleHandles(request, env, url);
    if (path.startsWith('/api/publishers'))       return handlePublishers(request, env, url);
    if (path.startsWith('/api/featured'))         return handleFeatured(request, env);
    if (path.startsWith('/api/removed'))          return handleRemoved(request, env, url);
    if (path.startsWith('/api/discover'))         return handleDiscover(request, env);
    if (path.startsWith('/api/admin/discover'))   return handleAdminDiscover(request, env);
    if (path.startsWith('/api/recommend'))        return handleRecommend(request, env);
    if (path.startsWith('/api/stats'))            return handleStats(request, env);
    if (path.startsWith('/api/avatar/'))          return handleAvatar(request, env, url);
    if (path === '/api/upload')                   return handleUpload(request, env);

    return json({ error: 'Not found' }, 404);
  },
};
