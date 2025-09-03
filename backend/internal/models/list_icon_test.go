package models

import "testing"

func TestIsValidListIcon(t *testing.T) {
    valid := []string{"HOUSE", "CAR", "PLANE", "PENCIL", "APPLE", "BROCCOLI", "TV", "SUNFLOWER"}
    for _, v := range valid {
        if !IsValidListIcon(v) { t.Fatalf("expected %s valid", v) }
    }
    invalid := []string{"", "home", "TREE", "car", " House ", "APPLE ", "SUN FLOWER"}
    for _, v := range invalid {
        if IsValidListIcon(v) { t.Fatalf("expected %s invalid", v) }
    }
}

