package models

// ListIcon defines the allowed icon enums for lists. Stored as uppercase strings.
const (
    ListIconHouse     = "HOUSE"
    ListIconCar       = "CAR"
    ListIconPlane     = "PLANE"
    ListIconPencil    = "PENCIL"
    ListIconApple     = "APPLE"
    ListIconBroccoli  = "BROCCOLI"
    ListIconTV        = "TV"
    ListIconSunflower = "SUNFLOWER"
)

// IsValidListIcon returns true when s is one of the allowed icon constants.
func IsValidListIcon(s string) bool {
    switch s {
    case ListIconHouse, ListIconCar, ListIconPlane, ListIconPencil, ListIconApple, ListIconBroccoli, ListIconTV, ListIconSunflower:
        return true
    default:
        return false
    }
}

