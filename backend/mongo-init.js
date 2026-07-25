db = db.getSiblingDB('futarfi');

db.createUser({
  user: 'futarchy_user',
  pwd: 'futarchy_password',
  roles: [
    {
      role: 'readWrite',
      db: 'futarchy'
    }
  ]
});

// Create initial collections
db.createCollection('markets');
db.createCollection('orders');
db.createCollection('orderbooks');

console.log('Database and collections created successfully');
