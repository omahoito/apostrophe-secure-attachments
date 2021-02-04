module.exports = {
  moogBundle: {
    directory: 'lib/modules',
    modules: [
      'apostrophe-secure-attachments-images',
      'apostrophe-secure-attachments-files'
    ]
  },
  improve: 'apostrophe-attachments',
  afterConstruct: function(self) {
    self.addRedirectUploadsRoute();
    self.addSecureUploadsRoute();
  },
  beforeConstruct: function(self, options) {
    options.uploadfs = options.uploadfs || {};
    options.uploadfs.uploadsPath = options.apos.rootDir + '/data/secure-uploads';
    const base = (options.apos.baseUrl || '') + options.apos.prefix;
    options.uploadfs.uploadsUrl = base + '/secure-uploads';
  },
  construct: function(self, options) {

    self.addRedirectUploadsRoute = function() {
      self.apos.app.get('/uploads/*', function(req, res) {
        return res.redirect('/secure-uploads/' + req.params[0]);
      });
    };
 
    self.addSecureUploadsRoute = function() {
      self.apos.app.get('/secure-uploads/*', self.secureAttachmentMiddleware, function(req, res) {
        return self.servePath(req, res);
      });
    };

    self.secureAttachmentMiddleware = async function(req, res, next) {
      const path = req.params[0];
      if (!path.startsWith('attachments/')) {
        return next();
      }
      try {
        // after "attachments..."
        const slashAt = req.params[0].indexOf('/');
        if (slashAt === -1) {
          throw 'notfound';
        }
        // comes the path to the file...
        const path = req.params[0].substring(slashAt + 1);
        const hyphenAt = path.indexOf('-');
        if (hyphenAt === -1) {
          throw 'notfound';
        }
        // the _id is everything up to the first -
        const _id = path.substring(0, hyphenAt);
        const attachment = await self.db.findOne({ _id: _id });
        if (!attachment) {
          throw 'notfound';
        }
        // Before an attachment is not attached to its first doc, only the user that uploaded it may access it, if the
        // user is known. This blocks eg. attachments being accidentally disclosed before the attachment is attached to a document.
        if (!attachment.utilized && attachment.ownerId) {
          if (!req.user || req.user._id !== attachment.ownerId) {
            throw 'forbidden'
          }
        }
        if (attachment.utilized) {

          // Once an attachment is attached to its first doc, the permissions
          // of its docs become its permissions. The test is: we have to be able to view
          // at least one of those docs as this user.
          //
          // Docs in the trash can pass this test for someone allowed to edit them,
          // but in practice only come through if it happens to be the "allowed in
          // trash" size used for media library preview; the rest
          // will have permissions set to 000 or the disabledFileKey renaming pattern
          // in effect, so things behave just as they would without this module.

          const ids = (attachment.docIds || []).concat(attachment.trashDocIds || []);
          if (!ids.length) {
            throw 'forbidden';
          }
          const doc = await self.apos.docs.find(req, { _id: { $in: ids } }).trash(null).published(null).toObject();
          if (!doc) {
            // We are not cool enough to view any of the docs that
            // contain this attachment (there can be more than one
            // due to page copying, piece copying and workflow)
            throw 'forbidden';
          }
        }
        // OK to let it through
        return next();
      } catch (e) {
        if (e === 'notfound') {
          return res.status(404).send('not found');
        } if (e === 'forbidden') {
          return res.status(403).send('forbidden');
        } else {
          self.apos.utils.error(e);
          return res.status(500).send('error');
        }
      }
    };

    // Send the file at the uploadfs path specified by req.params[0]
    // to the browser. Assumes local uploadfs backend. Streaming
    // securely from other backends would be expensive and slow.
    // Perhaps it could be implemented with local caching, but we
    // would also have to change the paths to not contain an _id
    // that is visible in the URL so folks don't just go straight
    // to the bucket, etc.

    self.servePath = function(req, res) {
      let path = self.options.uploadfs.uploadsPath + '/' + req.params[0];
      // Do not allow relative paths to escape the intended folder
      path = path.replace(/\.\./g, '');
      return res.sendFile(require('path').resolve(path));
    };

  }
};
