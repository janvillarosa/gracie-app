// Initialize a single-node replica set for local development.
// This runs automatically via docker-entrypoint-initdb.d when the data dir is empty.
try {
  rs.initiate({
    _id: "rs0",
    members: [
      { _id: 0, host: "mongo:27017" }
    ]
  });
  print("Replica set initiated: rs0");
} catch (e) {
  print("Replica set initiate error (likely already initiated):", e);
}

